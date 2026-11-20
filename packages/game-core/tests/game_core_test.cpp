#include "game_core.hpp"
#include "game_rules.hpp"

#include <functional>
#include <string>
#include <vector>
#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

namespace {
using Json = nlohmann::json;
using Method = std::string (*)(std::string);
Json call(Method method, const Json& request) {
    auto result = Json::parse(method(request.dump()));
    EXPECT_FALSE(result.contains("error")) << result.dump();
    return result;
}
Json initialize(std::uint32_t seed = 12345) { return call(apc::initialize_game, {{"seed", seed}}).at("state"); }
Json start(std::uint32_t seed = 12345) { return call(apc::start_project, {{"state", initialize(seed)}, {"project_id", "proj_ova_01"}}).at("state"); }
Json decide(const Json& state, const Json& decision) { return call(apc::apply_decision, {{"state", state}, {"decision", decision}}).at("state"); }
Json advance(const Json& state) { return call(apc::advance_day, {{"state", state}}); }
void expect_error(const std::string& output, const char* code) {
    const auto result = Json::parse(output);
    ASSERT_TRUE(result.is_object()); ASSERT_EQ(result.size(), 1U);
    ASSERT_TRUE(result.contains("error")); ASSERT_TRUE(result["error"].is_object());
    ASSERT_EQ(result["error"].size(), 2U); EXPECT_EQ(result["error"]["code"], code);
    ASSERT_TRUE(result["error"]["message"].is_string()); EXPECT_FALSE(result["error"]["message"].get<std::string>().empty());
}
Json finish(Json state) {
    for (int day = 0; day < 100 && state.at("phase") != "ended"; ++day) {
        if (state.at("phase") == "event_pending") state = call(apc::resolve_event, {{"state", state}, {"option_id", "opt_b"}}).at("state");
        else state = advance(state).at("state");
    }
    EXPECT_EQ(state.at("phase"), "ended");
    return state;
}
TEST(Initialize, FixedRosterAndThreeOffersWithBoundarySeeds) {
    for (auto seed : {0U, 12345U, 0xffffffffU}) {
        const auto state = initialize(seed);
        EXPECT_EQ(state.at("seed"), seed); EXPECT_EQ(state.at("day"), 1);
        EXPECT_EQ(state.at("funds"), 2000000); EXPECT_EQ(state.at("version"), 2);
        EXPECT_EQ(state.at("phase"), "idle"); EXPECT_EQ(state.at("staff").size(), 4U);
        EXPECT_EQ(state.at("offers").size(), 3U); EXPECT_TRUE(state.at("project").is_null());
    }
}
TEST(StartProject, GrantDeadlineAndReputationGate) {
    auto state = initialize();
    expect_error(apc::start_project(Json{{"state", state}, {"project_id", "proj_movie_01"}}.dump()), "INVALID_INPUT");
    expect_error(apc::start_project(Json{{"state", state}, {"project_id", "unknown"}}.dump()), "INVALID_INPUT");
    const auto output = call(apc::start_project, {{"state", state}, {"project_id", "proj_ova_01"}}).at("state");
    EXPECT_EQ(output.at("funds"), 10000000); EXPECT_EQ(output.at("project").at("deadline_day"), 20);
    EXPECT_EQ(output.at("phase"), "producing"); EXPECT_TRUE(output.at("offers").empty());
    EXPECT_EQ(output.at("seed"), state.at("seed")); EXPECT_EQ(state.at("funds"), 2000000);
    state["reputation"] = 20;
    EXPECT_EQ(call(apc::start_project, {{"state", state}, {"project_id", "proj_movie_01"}}).at("state").at("project").at("deadline_day"), 30);
}
TEST(Decision, ReversibleBeforeAdvanceAndDoesNotConsumeSeed) {
    const auto original = start();
    auto state = decide(original, {{"type", "outsource"}, {"stage", "post"}, {"enabled", true}});
    EXPECT_EQ(state.at("funds"), original.at("funds")); EXPECT_EQ(state.at("project").at("spent"), 0);
    EXPECT_EQ(decide(state, {{"type", "outsource"}, {"stage", "post"}, {"enabled", false}}), original);
    state = decide(original, {{"type", "overtime"}, {"staff_id", "staff_01"}, {"enabled", true}});
    EXPECT_EQ(decide(state, {{"type", "overtime"}, {"staff_id", "staff_01"}, {"enabled", false}}), original);
    state = decide(state, {{"type", "assign"}, {"staff_id", "staff_01"}, {"assignment", "rest"}});
    EXPECT_EQ(state.at("staff").at(0).at("overtime"), false);
    EXPECT_EQ(state.at("seed"), original.at("seed")); EXPECT_EQ(state.at("day"), 1);
    state = decide(state, {{"type", "policy"}, {"policy", "polish"}});
    EXPECT_EQ(state.at("project").at("policy"), "polish");
}
TEST(Decision, InvalidChoicesAndInsufficientFundsAreAtomic) {
    const auto state = start();
    for (const auto& decision : Json::array({
        {{"type", "assign"}, {"staff_id", "missing"}, {"assignment", "pre"}},
        {{"type", "assign"}, {"staff_id", "staff_01"}, {"assignment", "invalid"}},
        {{"type", "policy"}, {"policy", "invalid"}},
        {{"type", "outsource"}, {"stage", "invalid"}, {"enabled", true}},
        {{"type", "overtime"}, {"staff_id", "staff_01"}, {"enabled", 1}},
        {{"type", "unknown"}}
    })) expect_error(apc::apply_decision(Json{{"state", state}, {"decision", decision}}.dump()), "INVALID_INPUT");
    auto poor = state; poor["funds"] = 300000;
    const auto input = Json{{"state", poor}, {"decision", {{"type", "outsource"}, {"stage", "pre"}, {"enabled", true}}}}.dump();
    const auto before = input;
    expect_error(apc::apply_decision(input), "INSUFFICIENT_BUDGET"); EXPECT_EQ(input, before);
}
TEST(AdvanceDay, ExactGoldenDayAndSeed) {
    const auto state = start(); const auto before = state;
    const auto output = advance(state); const auto next = output.at("state");
    EXPECT_EQ(state, before); EXPECT_EQ(next.at("day"), 2); EXPECT_EQ(next.at("seed"), 87628868U);
    EXPECT_EQ(next.at("funds"), 9700000); EXPECT_EQ(next.at("project").at("spent"), 300000);
    EXPECT_EQ(next.at("phase"), "producing");
    EXPECT_EQ(next.at("project").at("stages").at("pre").at("progress"), 6);
    EXPECT_EQ(next.at("project").at("stages").at("mid").at("progress"), 6);
    EXPECT_EQ(next.at("project").at("stages").at("post").at("progress"), 6);
    EXPECT_EQ(output.at("report").at("funds_delta"), -300000);
    EXPECT_EQ(output.at("report").at("morale_delta"), -1);
}
TEST(AdvanceDay, OvertimeAndOutsourceChargedOnceAndReset) {
    auto state = decide(start(), {{"type", "outsource"}, {"stage", "pre"}, {"enabled", true}});
    state = decide(state, {{"type", "overtime"}, {"staff_id", "staff_01"}, {"enabled", true}});
    const auto next = advance(state).at("state");
    EXPECT_EQ(next.at("project").at("spent"), 825000); EXPECT_EQ(next.at("funds"), 9175000);
    EXPECT_EQ(next.at("staff").at(0).at("overtime"), false);
    EXPECT_EQ(next.at("staff").at(0).at("morale"), 73);
    EXPECT_EQ(next.at("project").at("stages").at("pre").at("outsourced"), false);
}
TEST(AdvanceDay, RestRecoversMoraleAndCannotBypassUpstream) {
    auto state = start(); state["staff"][0]["morale"] = 95;
    state = decide(state, {{"type", "assign"}, {"staff_id", "staff_01"}, {"assignment", "rest"}});
    const auto next = advance(state).at("state");
    EXPECT_EQ(next.at("staff").at(0).at("morale"), 100);
    for (auto stage : apc::rules::stages) EXPECT_EQ(next.at("project").at("stages").at(stage).at("progress"), 0);
}
TEST(AdvanceDay, RushTradesQualityAndMoraleForSpeedAndLowQualityReworks) {
    const auto normal = advance(start()).at("state");
    const auto rush = advance(decide(start(), {{"type", "policy"}, {"policy", "rush"}})).at("state");
    EXPECT_GT(rush.at("project").at("stages").at("pre").at("progress"), normal.at("project").at("stages").at("pre").at("progress"));
    EXPECT_LT(rush.at("project").at("stages").at("pre").at("quality"), normal.at("project").at("stages").at("pre").at("quality"));
    EXPECT_LT(rush.at("staff").at(0).at("morale"), normal.at("staff").at(0).at("morale"));
    auto state = start();
    for (auto& staff : state["staff"]) { staff["assignment"] = "pre"; staff["overtime"] = true; }
    state["project"]["policy"] = "rush";
    for (auto stage : apc::rules::stages) { state["project"]["stages"][stage]["progress"] = 50; state["project"]["stages"][stage]["quality"] = 1; }
    const auto next = advance(state); EXPECT_EQ(next.at("report").at("rework"), true);
    EXPECT_LE(next.at("state").at("project").at("stages").at("post").at("progress"), next.at("state").at("project").at("stages").at("mid").at("progress"));
}
TEST(AdvanceDay, BankruptcyDoesNotChargeOrConsumeDayAndSeed) {
    auto state = start(); state["funds"] = 299999;
    const auto next = advance(state).at("state");
    EXPECT_EQ(next.at("phase"), "ended"); EXPECT_EQ(next.at("end_reason"), "bankrupt");
    EXPECT_EQ(next.at("funds"), state.at("funds")); EXPECT_EQ(next.at("day"), state.at("day")); EXPECT_EQ(next.at("seed"), state.at("seed"));
    const auto settled = call(apc::calculate_result, {{"state", next}});
    EXPECT_EQ(settled.at("result").at("revenue"), 0);
}
TEST(AdvanceDay, DeadlineAndCompletionHavePriorityOverEvent) {
    auto state = start(13); state["project"]["deadline_day"] = 1;
    const auto deadline = advance(state).at("state");
    EXPECT_EQ(deadline.at("end_reason"), "deadline"); EXPECT_TRUE(deadline.at("pending_event").is_null());
    for (auto stage : apc::rules::stages) { state["project"]["stages"][stage]["progress"] = 99; state["project"]["stages"][stage]["quality"] = 80; }
    const auto completed = advance(state).at("state");
    EXPECT_EQ(completed.at("end_reason"), "completed"); EXPECT_TRUE(completed.at("pending_event").is_null());
    for (auto stage : apc::rules::stages) EXPECT_EQ(completed.at("project").at("stages").at(stage).at("progress"), 100);
}
TEST(Events, DeterministicTriggerAndNoRandomDrawOnResolve) {
    const auto pending = advance(start(13)).at("state");
    ASSERT_EQ(pending.at("phase"), "event_pending"); EXPECT_EQ(pending.at("seed"), 1035543048U);
    const auto next = call(apc::resolve_event, {{"state", pending}, {"option_id", "opt_b"}}).at("state");
    EXPECT_EQ(next.at("seed"), pending.at("seed")); EXPECT_EQ(next.at("day"), pending.at("day"));
    EXPECT_EQ(next.at("phase"), "producing"); EXPECT_TRUE(next.at("pending_event").is_null());
}
TEST(Events, CatalogOptionsCostsClampingAndForgeryRejected) {
    for (const auto& event : apc::rules::events()) {
        auto state = start(); state["phase"] = "event_pending"; state["pending_event"] = event;
        for (const auto& option : event.at("options")) {
            const auto next = call(apc::resolve_event, {{"state", state}, {"option_id", option.at("id")}}).at("state");
            for (const auto& staff : next.at("staff")) EXPECT_LE(staff.at("morale"), 100);
            EXPECT_EQ(next.at("seed"), state.at("seed"));
            if (option.at("effect").contains("funds")) {
                EXPECT_GT(next.at("project").at("spent"), 0);
                auto poor = state; poor["funds"] = 0;
                expect_error(apc::resolve_event(Json{{"state", poor}, {"option_id", option.at("id")}}.dump()), "INSUFFICIENT_BUDGET");
            }
        }
        expect_error(apc::resolve_event(Json{{"state", state}, {"option_id", "missing"}}.dump()), "INVALID_INPUT");
        state["pending_event"]["options"][0]["effect"]["funds"] = 99999999;
        expect_error(apc::resolve_event(Json{{"state", state}, {"option_id", "opt_a"}}.dump()), "INVALID_INPUT");
    }
}
TEST(Settlement, FullPlayableChainCarryOverAndCannotSettleTwice) {
    const auto ended = finish(start());
    ASSERT_EQ(ended.at("end_reason"), "completed");
    const auto result = call(apc::calculate_result, {{"state", ended}});
    const auto& state = result.at("state"); const auto& receipt = result.at("result");
    EXPECT_EQ(state.at("phase"), "idle"); EXPECT_TRUE(state.at("project").is_null());
    EXPECT_EQ(state.at("seed"), ended.at("seed")); EXPECT_EQ(state.at("day"), ended.at("day"));
    EXPECT_EQ(state.at("funds").get<std::int64_t>(), ended.at("funds").get<std::int64_t>() + receipt.at("revenue").get<std::int64_t>());
    EXPECT_EQ(receipt.at("profit").get<std::int64_t>(), receipt.at("revenue").get<std::int64_t>() - receipt.at("cost").get<std::int64_t>());
    EXPECT_EQ(ended.at("day"), 18); EXPECT_EQ(receipt.at("quality_score"), 79);
    EXPECT_EQ(receipt.at("grade"), "A"); EXPECT_EQ(receipt.at("cost"), 5100000);
    EXPECT_EQ(receipt.at("revenue"), 6320000); EXPECT_EQ(receipt.at("profit"), 1220000);
    EXPECT_EQ(state.at("reputation"), 10); EXPECT_EQ(state.at("funds"), 11220000);
    EXPECT_EQ(state.at("offers").size(), 3U);
    expect_error(apc::calculate_result(Json{{"state", state}}.dump()), "INVALID_PHASE");
    EXPECT_EQ(call(apc::start_project, {{"state", state}, {"project_id", "proj_tv_01"}}).at("state").at("project").at("start_day"), ended.at("day"));
}
TEST(Settlement, DeadlinePenaltyOverbudgetAndReputationFloor) {
    auto state = start(); state["project"]["deadline_day"] = 1; state["project"]["spent"] = 9000000;
    const auto receipt = call(apc::calculate_result, {{"state", advance(state).at("state")}});
    EXPECT_EQ(receipt.at("result").at("end_reason"), "deadline"); EXPECT_EQ(receipt.at("state").at("reputation"), 0);
    EXPECT_LT(receipt.at("result").at("profit"), 0);
}
TEST(Determinism, RepeatedInterleavedFullGamesAndBoundarySeeds) {
    for (const auto seed : {0U, 1U, 12345U, 0xffffffffU}) {
        const auto expected = call(apc::calculate_result, {{"state", finish(start(seed))}});
        finish(start(42));
        EXPECT_EQ(call(apc::calculate_result, {{"state", finish(start(seed))}}), expected);
    }
}
TEST(Phases, RejectOutOfOrderActions) {
    const auto idle = initialize(), producing = start();
    for (auto method : {apc::apply_decision, apc::advance_day, apc::resolve_event, apc::calculate_result}) expect_error(method(Json{{"state", idle}}.dump()), "INVALID_PHASE");
    for (auto method : {apc::start_project, apc::resolve_event, apc::calculate_result}) expect_error(method(Json{{"state", producing}}.dump()), "INVALID_PHASE");
    auto pending = producing; pending["phase"] = "event_pending"; pending["pending_event"] = apc::rules::events().at(0);
    expect_error(apc::advance_day(Json{{"state", pending}}.dump()), "INVALID_PHASE");
    const auto ended = finish(producing);
    expect_error(apc::advance_day(Json{{"state", ended}}.dump()), "INVALID_PHASE");
}
TEST(Validation, NumericBoundsNestedSchemaAndPhaseInvariants) {
    const std::vector<std::function<void(Json&)>> mutations = {
        [](Json& s) { s["version"] = 1; }, [](Json& s) { s["funds"] = -1; },
        [](Json& s) { s["funds"] = 9007199254740992ULL; }, [](Json& s) { s["funds"] = 1.5; },
        [](Json& s) { s["seed"] = 4294967296ULL; }, [](Json& s) { s["seed"] = -1; },
        [](Json& s) { s["day"] = 0; }, [](Json& s) { s["phase"] = "unknown"; },
        [](Json& s) { s["staff"][0]["morale"] = 101; }, [](Json& s) { s["staff"][0]["skill"] = -1; },
        [](Json& s) { s["staff"][0]["overtime"] = "true"; }, [](Json& s) { s["staff"][1]["id"] = "staff_01"; },
        [](Json& s) { s["staff"].erase(0); }, [](Json& s) { s["project"]["stages"]["pre"]["progress"] = -1; },
        [](Json& s) { s["project"]["stages"]["mid"]["progress"] = 1; },
        [](Json& s) { s["project"]["stages"]["post"]["quality"] = 101; },
        [](Json& s) { s["project"]["deadline_day"] = 0; }, [](Json& s) { s["project"]["budget"] = 1; },
        [](Json& s) { s["pending_event"] = Json::object(); }, [](Json& s) { s["end_reason"] = "completed"; },
        [](Json& s) { s["phase"] = "ended"; s["end_reason"] = "completed"; },
        [](Json& s) { s["phase"] = "idle"; }, [](Json& s) { s.erase("seed"); }
    };
    for (const auto& mutate : mutations) {
        auto state = start(); mutate(state);
        for (auto method : {apc::start_project, apc::apply_decision, apc::advance_day, apc::resolve_event, apc::calculate_result}) expect_error(method(Json{{"state", state}}.dump()), "INVALID_INPUT");
    }
}
TEST(Validation, SafeIntegerBoundariesAndOverflowRemainAtomic) {
    auto state = start(); state["funds"] = apc::rules::max_integer;
    EXPECT_EQ(advance(state).at("state").at("funds"), apc::rules::max_integer - 300000);
    state = initialize(); state["funds"] = apc::rules::max_integer;
    expect_error(apc::start_project(Json{{"state", state}, {"project_id", "proj_ova_01"}}.dump()), "INVALID_INPUT");
    state = start(); state["project"]["spent"] = apc::rules::max_integer;
    expect_error(apc::advance_day(Json{{"state", state}}.dump()), "INVALID_INPUT");
    state = initialize(); state["day"] = apc::rules::max_integer;
    expect_error(apc::start_project(Json{{"state", state}, {"project_id", "proj_ova_01"}}.dump()), "INVALID_INPUT");
}
class InvalidInput : public testing::TestWithParam<std::string> {};
TEST_P(InvalidInput, AllSixBoundariesReturnStructuredErrors) {
    for (auto method : {apc::initialize_game, apc::start_project, apc::apply_decision, apc::advance_day, apc::resolve_event, apc::calculate_result}) EXPECT_NO_THROW(expect_error(method(GetParam()), "INVALID_INPUT"));
}
INSTANTIATE_TEST_SUITE_P(JsonAndSchema, InvalidInput, testing::Values(
    "", "{", "undefined", "null", "true", "42", "\"text\"", "[]", "{}",
    R"({"seed":-1})", R"({"seed":4294967296})", R"({"seed":18446744073709551615})",
    R"({"seed":18446744073709551616})", R"({"seed":1.5})", R"({"seed":1.0})", R"({"seed":1e0})",
    R"({"seed":"1"})", R"({"seed":true})", R"({"seed":null})", R"({"seed":[]})", R"({"seed":{}})",
    R"({"seed":1e1000})", R"({"seed":NaN})", R"({"seed":1} trailing)", R"({"seed":1,})"
));
TEST(Validation, InvalidUtf8IsCaught) {
    std::string input = R"({"seed":1,"extra":")"; input += static_cast<char>(0xff); input += "\"}";
    expect_error(apc::initialize_game(input), "INVALID_INPUT");
}
}
