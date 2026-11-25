#include "game_core.hpp"
#include "game_rules.hpp"

#include <cstdint>
#include <functional>
#include <set>
#include <string>
#include <vector>
#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

namespace {
using Json = nlohmann::json;
using Method = std::string (*)(std::string);
constexpr std::int64_t max_i = apc::rules::max_integer;

Json call(Method method, const Json& request) {
    auto result = Json::parse(method(request.dump()));
    EXPECT_FALSE(result.contains("error")) << result.dump();
    return result;
}
Json initialize(std::uint32_t seed = 12345) { return call(apc::initialize_game, {{"seed", seed}}).at("state"); }
Json start(std::uint32_t seed = 12345, const char* offer = "proj_ova_01") {
    return call(apc::start_project, {{"state", initialize(seed)}, {"offer_id", offer}, {"mode", "contract"}, {"investment_percent", 0}}).at("state");
}
Json configure(const Json& state, const char* policy = "balanced", bool overtime = false) {
    const auto stage = state.at("project").at("current_stage").get<std::string>();
    const auto& recommended = state.at("project").at("stages").at(stage).at("recommended_configuration");
    Json configuration{{"assignments", recommended.at("assignments")}, {"policy", policy}, {"overtime", overtime}};
    return call(apc::apply_decision, {{"state", state}, {"decision", {{"type", "configure_stage"}, {"stage", stage}, {"configuration", configuration}}}}).at("state");
}
Json advance(const Json& state) { return call(apc::advance_week, {{"state", state}}); }
Json play_weeks(Json state, int weeks, const char* policy = "balanced") {
    for (int i = 0; i < weeks && state.at("phase") == "producing"; ++i) {
        const auto stage = state.at("project").at("current_stage").get<std::string>();
        if (state.at("project").at("stages").at(stage).at("status") == "ready") state = configure(state, policy);
        state = advance(state).at("state");
    }
    return state;
}
Json play_until_ready(Json state, const char* policy = "balanced") {
    for (int i = 0; i < 60 && state.at("phase") == "producing"; ++i) {
        const auto stage = state.at("project").at("current_stage").get<std::string>();
        if (state.at("project").at("stages").at(stage).at("status") == "ready") state = configure(state, policy);
        state = advance(state).at("state");
    }
    EXPECT_EQ(state.at("phase"), "project_ready");
    return state;
}
std::int64_t costs_total(const Json& finance) {
    std::int64_t total = 0;
    for (auto key : {"salary", "operations", "production", "temporary", "outsourcing", "events", "extension", "penalty"}) total += finance.at("costs").at(key).get<std::int64_t>();
    return total;
}
void expect_error(const std::string& output, const char* code) {
    const auto result = Json::parse(output);
    ASSERT_TRUE(result.is_object()); ASSERT_EQ(result.size(), 1U);
    ASSERT_TRUE(result.contains("error")); ASSERT_TRUE(result["error"].is_object());
    ASSERT_EQ(result["error"].size(), 2U); EXPECT_EQ(result["error"]["code"], code);
    ASSERT_TRUE(result["error"]["message"].is_string()); EXPECT_FALSE(result["error"]["message"].get<std::string>().empty());
}
}

TEST(Initialize, V3CompanyStateAndFourOffers) {
    for (auto seed : {0U, 12345U, 0xffffffffU}) {
        const auto state = initialize(seed);
        EXPECT_EQ(state.at("seed"), seed); EXPECT_EQ(state.at("version"), 3);
        EXPECT_EQ(state.at("phase"), "idle");
        EXPECT_EQ(state.at("company").at("week"), 0); EXPECT_EQ(state.at("company").at("status"), "running");
        EXPECT_TRUE(state.at("company").at("end_reason").is_null());
        EXPECT_EQ(state.at("company").at("funds"), 2000000); EXPECT_EQ(state.at("company").at("initial_funds"), 2000000);
        EXPECT_EQ(state.at("company").at("reputation"), 0); EXPECT_EQ(state.at("company").at("staff").size(), 4U);
        EXPECT_EQ(state.at("offers").size(), 4U); EXPECT_TRUE(state.at("project").is_null());
        EXPECT_TRUE(state.at("pending_event").is_null()); EXPECT_TRUE(state.at("history").empty());
        EXPECT_TRUE(state.at("recruitment_pool").empty()); EXPECT_TRUE(state.at("suppliers").empty());
        EXPECT_TRUE(state.at("last_project_id").is_null()); EXPECT_TRUE(state.at("company_result").is_null());
        EXPECT_EQ(state.at("preview").at("next_week"), 1); EXPECT_EQ(state.at("preview").at("total_cost"), 180000);
    }
    const auto state = initialize();
    EXPECT_EQ(state.at("offers").at(0).at("id"), "proj_ova_01");
    EXPECT_EQ(state.at("offers").at(0).at("contract_budget"), 4000000);
    EXPECT_EQ(state.at("offers").at(0).at("allowed_modes"), Json({"contract"}));
    EXPECT_EQ(state.at("offers").at(2).at("contract_budget"), 6000000);
    EXPECT_EQ(state.at("company").at("staff").at(0).at("weekly_salary"), 45000);
    EXPECT_EQ(state.at("company").at("staff").at(0).at("abilities").at("direction"), 75);
    EXPECT_EQ(state.at("company").at("staff").at(0).at("morale"), 80);
}
TEST(StartProject, GrantGatesModesAndErrors) {
    const auto state = initialize();
    expect_error(apc::start_project(Json{{"state", state}, {"offer_id", "unknown"}, {"mode", "contract"}, {"investment_percent", 0}}.dump()), "INVALID_INPUT");
    expect_error(apc::start_project(Json{{"state", state}, {"offer_id", "proj_ova_01"}, {"mode", "committee"}, {"investment_percent", 0}}.dump()), "MODE_NOT_ALLOWED");
    expect_error(apc::start_project(Json{{"state", state}, {"offer_id", "proj_ova_01"}, {"mode", "self_funded"}, {"investment_percent", 0}}.dump()), "INVALID_INPUT");
    expect_error(apc::start_project(Json{{"state", state}, {"offer_id", "proj_ova_01"}, {"mode", "contract"}, {"investment_percent", 5}}.dump()), "INVALID_INPUT");
    const auto tv = call(apc::start_project, {{"state", state}, {"offer_id", "proj_tv_01"}, {"mode", "contract"}, {"investment_percent", 0}}).at("state");
    EXPECT_EQ(tv.at("company").at("funds"), 8000000);
    EXPECT_EQ(tv.at("project").at("deadline_week"), 24);
    const auto output = call(apc::start_project, {{"state", state}, {"offer_id", "proj_ova_01"}, {"mode", "contract"}, {"investment_percent", 0}}).at("state");
    EXPECT_EQ(output.at("company").at("funds"), 6000000);
    EXPECT_EQ(output.at("company").at("finance").at("contract_received"), 4000000);
    EXPECT_EQ(output.at("project").at("start_week"), 0); EXPECT_EQ(output.at("project").at("deadline_week"), 14);
    EXPECT_EQ(output.at("project").at("opening_funds"), 2000000);
    EXPECT_EQ(output.at("phase"), "producing"); EXPECT_TRUE(output.at("offers").empty());
    EXPECT_EQ(output.at("project").at("stages").at("script").at("status"), "ready");
    EXPECT_EQ(output.at("project").at("stages").at("postproduction").at("status"), "pending");
    EXPECT_TRUE(output.at("project").at("stages").at("script").at("recommended_configuration").is_object());
    EXPECT_TRUE(output.at("preview").is_null());
    expect_error(apc::start_project(Json{{"state", output}, {"offer_id", "proj_short_01"}, {"mode", "contract"}, {"investment_percent", 0}}.dump()), "INVALID_PHASE");
}
TEST(Decision, ConfigureLocksStageAndChargesNothing) {
    const auto state = start();
    const auto next = configure(state);
    EXPECT_EQ(next.at("company").at("funds"), state.at("company").at("funds"));
    EXPECT_EQ(next.at("project").at("stages").at("script").at("status"), "active");
    EXPECT_EQ(next.at("preview").at("total_cost"), 210000);
    expect_error(apc::apply_decision(Json{{"state", next}, {"decision", {{"type", "configure_stage"}, {"stage", "script"}, {"configuration", Json::object()}}}}.dump()), "STAGE_LOCKED");
    expect_error(apc::apply_decision(Json{{"state", next}, {"decision", {{"type", "configure_stage"}, {"stage", "storyboard"}, {"configuration", Json::object()}}}}.dump()), "INVALID_INPUT");
    Json good{{"assignments", Json::array({{{"staff_id", "staff_01"}, {"role", "director"}, {"focus", "planning"}}})}, {"policy", "balanced"}, {"overtime", false}};
    Json bad_staff = good; bad_staff["assignments"][0]["staff_id"] = "staff_99";
    Json bad_role = good; bad_role["assignments"][0]["role"] = "producer";
    Json bad_focus = good; bad_focus["assignments"][0]["focus"] = "singing";
    Json bad_policy = good; bad_policy["policy"] = "rush";
    Json bad_overtime = good; bad_overtime["overtime"] = 1;
    for (const auto& configuration : {bad_staff, bad_role, bad_focus, bad_policy, bad_overtime})
        expect_error(apc::apply_decision(Json{{"state", state}, {"decision", {{"type", "configure_stage"}, {"stage", "script"}, {"configuration", configuration}}}}.dump()), "INVALID_INPUT");
    expect_error(apc::apply_decision(Json{{"state", initialize()}, {"decision", {{"type", "configure_stage"}, {"stage", "script"}, {"configuration", good}}}}.dump()), "INVALID_PHASE");
}
TEST(AdvanceWeek, IdlePaysFixedCostsAndRefreshesOffers) {
    const auto state = initialize();
    const auto output = advance(state);
    const auto& next = output.at("state");
    EXPECT_EQ(next.at("company").at("week"), 1);
    EXPECT_EQ(next.at("company").at("funds"), 1820000);
    EXPECT_EQ(next.at("seed"), 87628868U);
    EXPECT_EQ(next.at("offers").at(0).at("id"), "proj_short_03");
    EXPECT_EQ(next.at("offers").at(3).at("id"), "proj_movie_02");
    EXPECT_EQ(output.at("report").at("funds_delta"), -180000);
    EXPECT_EQ(output.at("report").at("costs").at("salary"), 150000);
    EXPECT_EQ(output.at("report").at("costs").at("operations"), 30000);
    EXPECT_TRUE(output.at("report").at("stage_deltas").empty());
    EXPECT_TRUE(output.at("report").at("staff_deltas").empty());
    EXPECT_EQ(next.at("preview").at("total_cost"), 180000);

    auto poor = initialize(); poor["company"]["funds"] = 179999;
    const auto bankrupt = advance(poor);
    EXPECT_EQ(bankrupt.at("state").at("company").at("status"), "closing");
    EXPECT_EQ(bankrupt.at("state").at("company").at("end_reason"), "bankrupt");
    EXPECT_EQ(bankrupt.at("state").at("company").at("funds"), 179999);
    EXPECT_EQ(bankrupt.at("state").at("company").at("week"), 0);
    EXPECT_EQ(bankrupt.at("state").at("seed"), poor.at("seed"));
    EXPECT_TRUE(bankrupt.at("state").at("offers").empty());
    EXPECT_TRUE(bankrupt.at("state").at("preview").is_null());
    EXPECT_EQ(bankrupt.at("report").at("funds_delta"), 0);
    EXPECT_EQ(bankrupt.at("report").at("costs").at("salary"), 0);
    EXPECT_EQ(bankrupt.at("report").at("messages").size(), 1U);
}
TEST(AdvanceWeek, GoldenProductionAndStaffDeltas) {
    const auto configured = configure(start());
    const auto output = advance(configured);
    const auto& next = output.at("state");
    EXPECT_EQ(next.at("seed"), configured.at("seed"));
    EXPECT_EQ(next.at("company").at("week"), 1);
    EXPECT_EQ(next.at("company").at("funds"), 5790000);
    const auto& stage = next.at("project").at("stages").at("script");
    EXPECT_EQ(stage.at("work_done"), 10); EXPECT_EQ(stage.at("quality"), 42);
    EXPECT_EQ(stage.at("status"), "active");
    EXPECT_EQ(next.at("project").at("finance").at("costs").at("salary"), 150000);
    EXPECT_EQ(next.at("project").at("finance").at("costs").at("production"), 30000);
    EXPECT_EQ(next.at("company").at("staff").at(0).at("morale"), 78);
    EXPECT_EQ(next.at("company").at("staff").at(0).at("fatigue"), 4);
    EXPECT_EQ(next.at("company").at("staff").at(0).at("experience").at("planning"), 2);
    EXPECT_EQ(output.at("report").at("funds_delta"), -210000);
    EXPECT_EQ(output.at("report").at("costs").at("production"), 30000);
    ASSERT_EQ(output.at("report").at("stage_deltas").size(), 1U);
    EXPECT_EQ(output.at("report").at("stage_deltas").at(0).at("stage"), "script");
    EXPECT_EQ(output.at("report").at("stage_deltas").at(0).at("work_done_delta"), 10);
    EXPECT_EQ(output.at("report").at("stage_deltas").at(0).at("quality_delta"), 42);
    ASSERT_EQ(output.at("report").at("staff_deltas").size(), 4U);
    EXPECT_EQ(output.at("report").at("staff_deltas").at(0).at("morale_delta"), -2);
    EXPECT_EQ(output.at("report").at("staff_deltas").at(0).at("fatigue_delta"), 4);
    EXPECT_EQ(output.at("report").at("staff_deltas").at(0).at("experience").at("planning"), 2);
    EXPECT_EQ(output.at("report").at("staff_deltas").at(1).at("experience").at("drawing"), 0);
}
TEST(AdvanceWeek, StageCompletionAndReadiness) {
    const auto state = play_weeks(configure(start()), 3);
    EXPECT_EQ(state.at("project").at("stages").at("script").at("status"), "completed");
    const auto& result = state.at("project").at("stages").at("script").at("result");
    EXPECT_EQ(result.at("weeks_spent"), 3); EXPECT_EQ(result.at("quality"), 42);
    EXPECT_EQ(result.at("costs").at("production"), 90000); EXPECT_EQ(result.at("team").size(), 4U);
    EXPECT_EQ(state.at("project").at("current_stage"), "storyboard");
    EXPECT_EQ(state.at("project").at("stages").at("storyboard").at("status"), "ready");
    EXPECT_TRUE(state.at("project").at("stages").at("storyboard").at("recommended_configuration").is_object());
    EXPECT_TRUE(state.at("preview").is_null());
    expect_error(apc::advance_week(Json{{"state", state}}.dump()), "INVALID_PHASE");
}
TEST(AdvanceWeek, OvertimeCostsMoraleButNotSpeed) {
    const auto normal = advance(configure(start())).at("state");
    const auto overtime = advance(configure(start(), "balanced", true)).at("state");
    EXPECT_EQ(overtime.at("company").at("funds"), 5690000);
    EXPECT_EQ(overtime.at("project").at("finance").at("costs").at("production"), 130000);
    EXPECT_EQ(overtime.at("project").at("stages").at("script").at("work_done"), normal.at("project").at("stages").at("script").at("work_done"));
    EXPECT_EQ(normal.at("company").at("staff").at(0).at("morale"), 78);
    EXPECT_EQ(overtime.at("company").at("staff").at(0).at("morale"), 72);
}
TEST(AdvanceWeek, PoliciesTradeSpeedQualityCostMorale) {
    const auto quality = advance(configure(start(), "quality")).at("state");
    const auto balanced = advance(configure(start())).at("state");
    const auto deadline = advance(configure(start(), "deadline")).at("state");
    EXPECT_EQ(quality.at("project").at("stages").at("script").at("work_done"), 7);
    EXPECT_EQ(balanced.at("project").at("stages").at("script").at("work_done"), 10);
    EXPECT_EQ(deadline.at("project").at("stages").at("script").at("work_done"), 15);
    EXPECT_EQ(quality.at("project").at("stages").at("script").at("quality"), 54);
    EXPECT_EQ(balanced.at("project").at("stages").at("script").at("quality"), 42);
    EXPECT_EQ(deadline.at("project").at("stages").at("script").at("quality"), 33);
    EXPECT_EQ(quality.at("project").at("finance").at("costs").at("production"), 33000);
    EXPECT_EQ(deadline.at("project").at("finance").at("costs").at("production"), 27000);
    EXPECT_LT(balanced.at("company").at("staff").at(0).at("morale"), quality.at("company").at("staff").at(0).at("morale"));
    EXPECT_LT(deadline.at("company").at("staff").at(0).at("morale"), balanced.at("company").at("staff").at(0).at("morale"));
}
TEST(AdvanceWeek, QualityCarriesOverCappedByPreviousStage) {
    const auto capped = [&] {
        auto state = play_weeks(configure(start()), 3);
        state["project"]["stages"]["script"]["result"]["quality"] = 10;
        return advance(configure(state, "quality")).at("state");
    }();
    EXPECT_EQ(capped.at("project").at("stages").at("storyboard").at("quality"), 46);
    EXPECT_EQ(capped.at("project").at("stages").at("storyboard").at("work_done"), 11);
    const auto uncapped = advance(configure(play_weeks(configure(start()), 3), "quality")).at("state");
    EXPECT_EQ(uncapped.at("project").at("stages").at("storyboard").at("quality"), 65);  // 42×60%+40 封顶
}
TEST(AdvanceWeek, DeadlineAndBankruptcyAndTimeLimit) {
    auto state = configure(start());
    state["project"]["deadline_week"] = 2;
    const auto late = play_weeks(state, 2);
    EXPECT_EQ(late.at("phase"), "project_ready");
    EXPECT_EQ(late.at("project").at("delivery_reason"), "deadline");
    EXPECT_EQ(late.at("company").at("week"), 2);
    EXPECT_EQ(late.at("project").at("stages").at("script").at("work_done"), 20);

    auto broke = configure(start()); broke["company"]["funds"] = 209999;
    const auto eventless = advance(broke).at("state");
    EXPECT_EQ(eventless.at("company").at("status"), "closing");
    EXPECT_EQ(eventless.at("company").at("end_reason"), "bankrupt");
    EXPECT_EQ(eventless.at("phase"), "project_ready");
    EXPECT_EQ(eventless.at("project").at("delivery_reason"), "company_closed");
    EXPECT_EQ(eventless.at("company").at("funds"), 209999);
    EXPECT_EQ(eventless.at("company").at("week"), 0);
    EXPECT_EQ(eventless.at("project").at("stages").at("script").at("work_done"), 0);
    EXPECT_TRUE(eventless.at("preview").is_null());

    auto long_game = initialize(); long_game["company"]["funds"] = 100000000;
    for (int week = 0; week < 519; ++week) long_game = advance(long_game).at("state");
    EXPECT_EQ(long_game.at("company").at("week"), 519);
    EXPECT_EQ(long_game.at("company").at("status"), "running");
    long_game = advance(long_game).at("state");
    EXPECT_EQ(long_game.at("company").at("week"), 520);
    EXPECT_EQ(long_game.at("company").at("status"), "closing");
    EXPECT_EQ(long_game.at("company").at("end_reason"), "time_limit");
    EXPECT_EQ(long_game.at("company").at("funds"), 100000000 - 520 * 180000);
    EXPECT_TRUE(long_game.at("offers").empty());
    expect_error(apc::advance_week(Json{{"state", long_game}}.dump()), "COMPANY_ENDED");
    const auto summary = call(apc::calculate_result, {{"state", long_game}, {"scope", "company"}});
    EXPECT_EQ(summary.at("result").at("weeks"), 520);
    EXPECT_EQ(summary.at("result").at("rating"), "stable");
    EXPECT_TRUE(summary.at("result").at("best_work_id").is_null());
}
TEST(CalculateResult, DeadlinePenaltyGolden) {
    auto state = configure(start());
    state["project"]["deadline_week"] = 2;
    state = play_weeks(state, 2);
    const auto output = call(apc::calculate_result, {{"state", state}, {"scope", "project"}});
    const auto& receipt = output.at("result");
    EXPECT_EQ(receipt.at("end_reason"), "deadline");
    EXPECT_EQ(receipt.at("quality_score"), 6);
    EXPECT_EQ(receipt.at("commercial_score"), 36);
    EXPECT_EQ(receipt.at("commercial_revenue"), 540000);
    EXPECT_EQ(receipt.at("finance").at("costs").at("penalty"), 800000);
    EXPECT_EQ(receipt.at("profit"), 2780000);
    EXPECT_EQ(receipt.at("id"), "proj_ova_01");
    EXPECT_EQ(receipt.at("team").size(), 4U);
    EXPECT_EQ(output.at("state").at("company").at("funds"), 4780000);
    EXPECT_EQ(output.at("state").at("company").at("reputation"), 0);
    EXPECT_EQ(output.at("state").at("phase"), "project_settled");
    EXPECT_TRUE(output.at("state").at("project").is_null());
    EXPECT_EQ(output.at("state").at("last_project_id"), "proj_ova_01");
    EXPECT_EQ(output.at("state").at("history").size(), 1U);
    expect_error(apc::calculate_result(Json{{"state", output.at("state")}, {"scope", "project"}}.dump()), "INVALID_PHASE");
}
TEST(CalculateResult, InvariantsAndReturnToMarket) {
    const auto state = play_until_ready(configure(start(), "deadline"));
    EXPECT_GE(state.at("company").at("week"), 1);
    const auto output = call(apc::calculate_result, {{"state", state}, {"scope", "project"}});
    const auto& receipt = output.at("result");
    const auto& settled = output.at("state");
    EXPECT_EQ(receipt.at("profit").get<std::int64_t>(), receipt.at("finance").at("contract_received").get<std::int64_t>() - costs_total(receipt.at("finance")));
    EXPECT_EQ(settled.at("company").at("funds").get<std::int64_t>(), settled.at("company").at("initial_funds").get<std::int64_t>()
        + settled.at("company").at("finance").at("contract_received").get<std::int64_t>() - costs_total(settled.at("company").at("finance")));
    const auto returned = call(apc::apply_decision, {{"state", settled}, {"decision", {{"type", "return_to_market"}}}}).at("state");
    EXPECT_EQ(returned.at("phase"), "idle");
    EXPECT_TRUE(returned.at("last_project_id").is_null());
    EXPECT_EQ(returned.at("offers").size(), 4U);
    EXPECT_EQ(returned.at("seed"), 87628868U);
    for (const auto& offer : returned.at("offers")) EXPECT_NE(offer.at("id").get<std::string>(), std::string("proj_ova_01"));
    expect_error(apc::calculate_result(Json{{"state", start()}, {"scope", "project"}}.dump()), "INVALID_PHASE");
    expect_error(apc::calculate_result(Json{{"state", start()}, {"scope", "company"}}.dump()), "INVALID_PHASE");
    expect_error(apc::calculate_result(Json{{"state", initialize()}, {"scope", "unknown"}}.dump()), "INVALID_INPUT");
    expect_error(apc::calculate_result(Json{{"state", initialize()}, {"scope", "company"}}.dump()), "INVALID_PHASE");
}
TEST(Endings, VoluntaryEndSettlesPendingProjectThenSummary) {
    auto state = play_weeks(configure(start()), 1);
    state = call(apc::apply_decision, {{"state", state}, {"decision", {{"type", "end_company"}}}}).at("state");
    EXPECT_EQ(state.at("company").at("status"), "closing");
    EXPECT_EQ(state.at("company").at("end_reason"), "voluntary");
    EXPECT_EQ(state.at("phase"), "project_ready");
    EXPECT_EQ(state.at("project").at("delivery_reason"), "company_closed");
    EXPECT_EQ(state.at("company").at("week"), 1);
    state = call(apc::calculate_result, {{"state", state}, {"scope", "project"}}).at("state");
    EXPECT_EQ(state.at("company").at("funds"), 5390000);
    expect_error(apc::apply_decision(Json{{"state", state}, {"decision", {{"type", "return_to_market"}}}}.dump()), "COMPANY_ENDED");
    const auto ended = call(apc::calculate_result, {{"state", state}, {"scope", "company"}});
    EXPECT_EQ(ended.at("state").at("phase"), "company_ended");
    EXPECT_EQ(ended.at("state").at("company").at("status"), "ended");
    EXPECT_EQ(ended.at("result").at("reason"), "voluntary");
    EXPECT_EQ(ended.at("result").at("total_projects"), 1);
    EXPECT_EQ(ended.at("result").at("best_work_id"), "proj_ova_01");
    EXPECT_EQ(ended.at("result").at("final_funds"), 5390000);
    EXPECT_EQ(ended.at("result").at("net_cash_change"), 3390000);
    EXPECT_EQ(ended.at("result").at("rating"), "stable");
    EXPECT_EQ(ended.at("state").at("company_result"), ended.at("result"));
    expect_error(apc::calculate_result(Json{{"state", ended.at("state")}, {"scope", "company"}}.dump()), "INVALID_PHASE");
    expect_error(apc::advance_week(Json{{"state", ended.at("state")}}.dump()), "COMPANY_ENDED");
    expect_error(apc::apply_decision(Json{{"state", ended.at("state")}, {"decision", {{"type", "end_company"}}}}.dump()), "COMPANY_ENDED");

    auto idle = call(apc::apply_decision, {{"state", initialize()}, {"decision", {{"type", "end_company"}}}}).at("state");
    EXPECT_EQ(idle.at("phase"), "idle"); EXPECT_TRUE(idle.at("offers").empty());
    idle = call(apc::calculate_result, {{"state", idle}, {"scope", "company"}}).at("state");
    EXPECT_EQ(idle.at("phase"), "company_ended");
    EXPECT_EQ(idle.at("company_result").at("rating"), "small");
    EXPECT_TRUE(idle.at("company_result").at("best_work_id").is_null());
    EXPECT_EQ(idle.at("company_result").at("total_projects"), 0);
}
TEST(Endings, BankruptSettlementGoesNegativeAndSummaryFails) {
    auto state = configure(start()); state["company"]["funds"] = 209999;
    state = advance(state).at("state");
    state = call(apc::calculate_result, {{"state", state}, {"scope", "project"}}).at("state");
    EXPECT_EQ(state.at("company").at("funds"), -190001);
    EXPECT_EQ(state.at("company").at("status"), "closing");
    EXPECT_EQ(state.at("company").at("end_reason"), "bankrupt");
    const auto ended = call(apc::calculate_result, {{"state", state}, {"scope", "company"}});
    EXPECT_EQ(ended.at("result").at("rating"), "failed");
    EXPECT_EQ(ended.at("result").at("reason"), "bankrupt");
    EXPECT_EQ(ended.at("result").at("net_cash_change"), -2190001);
}
TEST(Decisions, M1RejectedActions) {
    const auto state = start();
    expect_error(apc::apply_decision(Json{{"state", state}, {"decision", {{"type", "request_extension"}}}}.dump()), "MODE_NOT_ALLOWED");
    expect_error(apc::apply_decision(Json{{"state", initialize()}, {"decision", {{"type", "hire_core"}, {"candidate_id", "cand_01"}}}}.dump()), "INVALID_INPUT");
    expect_error(apc::apply_decision(Json{{"state", initialize()}, {"decision", {{"type", "hire_temporary"}, {"candidate_id", "cand_01"}}}}.dump()), "INVALID_PHASE");
    expect_error(apc::apply_decision(Json{{"state", state}, {"decision", {{"type", "hire_temporary"}, {"candidate_id", "cand_01"}}}}.dump()), "INVALID_INPUT");
    expect_error(apc::apply_decision(Json{{"state", state}, {"decision", {{"type", "outsource"}, {"supplier_id", "sup_01"}, {"stage", "script"}}}}.dump()), "INVALID_INPUT");
    expect_error(apc::apply_decision(Json{{"state", initialize()}, {"decision", {{"type", "request_extension"}}}}.dump()), "INVALID_PHASE");
    expect_error(apc::resolve_event(Json{{"state", state}, {"option_id", "opt_a"}}.dump()), "INVALID_PHASE");
    auto tampered = state; tampered["phase"] = "event_pending"; tampered["pending_event"] = Json::object();
    expect_error(apc::resolve_event(Json{{"state", tampered}, {"option_id", "opt_a"}}.dump()), "INVALID_INPUT");
    expect_error(apc::apply_decision(Json{{"state", state}, {"decision", {{"type", "assign"}, {"staff_id", "staff_01"}, {"assignment", "rest"}}}}.dump()), "INVALID_INPUT");

    auto raised = call(apc::apply_decision, {{"state", initialize()}, {"decision", {{"type", "raise_salary"}, {"staff_id", "staff_01"}, {"weekly_salary", 50000}}}}).at("state");
    EXPECT_EQ(raised.at("company").at("staff").at(0).at("weekly_salary"), 50000);
    EXPECT_EQ(raised.at("preview").at("total_cost"), 185000);
    expect_error(apc::apply_decision(Json{{"state", raised}, {"decision", {{"type", "raise_salary"}, {"staff_id", "staff_01"}, {"weekly_salary", 45000}}}}.dump()), "INVALID_INPUT");
    expect_error(apc::apply_decision(Json{{"state", state}, {"decision", {{"type", "raise_salary"}, {"staff_id", "staff_01"}, {"weekly_salary", 60000}}}}.dump()), "INVALID_PHASE");
    expect_error(apc::apply_decision(Json{{"state", initialize()}, {"decision", {{"type", "raise_salary"}, {"staff_id", "staff_99"}, {"weekly_salary", 60000}}}}.dump()), "INVALID_INPUT");
    auto spent = [&] {
        auto s = play_until_ready(configure(start()));
        return call(apc::calculate_result, {{"state", s}, {"scope", "project"}}).at("state");
    }();
    spent = call(apc::apply_decision, {{"state", spent}, {"decision", {{"type", "raise_salary"}, {"staff_id", "staff_02"}, {"weekly_salary", 40000}}}}).at("state");
    EXPECT_EQ(spent.at("company").at("staff").at(1).at("weekly_salary"), 40000);
}
TEST(Determinism, SameSeedSameGameAcrossInterruptions) {
    for (auto seed : {0U, 1U, 7U, 12345U, 0xffffffffU}) {
        const auto first = Json::parse(apc::calculate_result(Json{{"state", play_until_ready(configure(start(seed), "deadline"))}, {"scope", "project"}}.dump()));
        play_until_ready(configure(start(4242), "quality"));
        const auto second = Json::parse(apc::calculate_result(Json{{"state", play_until_ready(configure(start(seed), "deadline"))}, {"scope", "project"}}.dump()));
        EXPECT_EQ(first, second) << "seed " << seed;
    }
}
TEST(Phases, RejectOutOfOrderActions) {
    const auto idle = initialize(), producing = start();
    expect_error(apc::apply_decision(Json{{"state", idle}, {"decision", {{"type", "return_to_market"}}}}.dump()), "INVALID_PHASE");
    expect_error(apc::resolve_event(Json{{"state", idle}}.dump()), "INVALID_PHASE");
    expect_error(apc::start_project(Json{{"state", producing}, {"offer_id", "proj_short_01"}, {"mode", "contract"}, {"investment_percent", 0}}.dump()), "INVALID_PHASE");
    const auto active = configure(producing);
    expect_error(apc::calculate_result(Json{{"state", active}, {"scope", "project"}}.dump()), "INVALID_PHASE");
    const auto ready = play_until_ready(active);
    expect_error(apc::advance_week(Json{{"state", ready}}.dump()), "INVALID_PHASE");
    expect_error(apc::apply_decision(Json{{"state", ready}, {"decision", {{"type", "configure_stage"}, {"stage", "script"}, {"configuration", Json::object()}}}}.dump()), "INVALID_PHASE");
    const auto settled = call(apc::calculate_result, {{"state", ready}, {"scope", "project"}}).at("state");
    expect_error(apc::advance_week(Json{{"state", settled}}.dump()), "INVALID_PHASE");
    expect_error(apc::start_project(Json{{"state", settled}, {"offer_id", "proj_short_01"}, {"mode", "contract"}, {"investment_percent", 0}}.dump()), "INVALID_PHASE");
}
namespace {
Json settledBase() {
    auto state = configure(start(3));
    state["project"]["deadline_week"] = 2;
    state = play_weeks(state, 2);
    return call(apc::calculate_result, {{"state", state}, {"scope", "project"}}).at("state");
}
}
TEST(Game, ContractFullChainAndMarketRotation) {
    const auto ready = play_until_ready(configure(start()));
    EXPECT_EQ(ready.at("company").at("week"), 14);
    EXPECT_EQ(ready.at("project").at("delivery_reason"), "deadline");
    const auto output = call(apc::calculate_result, {{"state", ready}, {"scope", "project"}});
    auto state = output.at("state");
    EXPECT_EQ(state.at("company").at("funds"), 2260000);
    EXPECT_EQ(costs_total(state.at("company").at("finance")), 3740000);
    state = call(apc::apply_decision, {{"state", state}, {"decision", {{"type", "return_to_market"}}}}).at("state");
    const std::vector<std::string> expected{"proj_short_03", "proj_tv_03", "proj_ova_04", "proj_movie_02"};
    for (std::size_t i = 0; i < expected.size(); ++i) EXPECT_EQ(state.at("offers").at(i).at("id"), expected[i]);
    state = call(apc::start_project, {{"state", state}, {"offer_id", "proj_short_03"}, {"mode", "contract"}, {"investment_percent", 0}}).at("state");
    EXPECT_EQ(state.at("company").at("funds"), 2260000 + 3200000);
    EXPECT_EQ(state.at("project").at("start_week"), 14);
    EXPECT_EQ(state.at("project").at("deadline_week"), 25);
}
TEST(Game, ExhaustedCatalogUsesVariantSuffixes) {
    const auto back = call(apc::apply_decision, {{"state", settledBase()}, {"decision", {{"type", "return_to_market"}}}}).at("state");
    EXPECT_EQ(back.at("offers").at(0).at("id"), "proj_ova_04");
    EXPECT_EQ(back.at("offers").at(1).at("id"), "proj_movie_02");
    EXPECT_EQ(back.at("offers").at(2).at("id"), "proj_ova_01_r2");
    EXPECT_EQ(back.at("offers").at(2).at("contract_budget"), 4000000);
    EXPECT_NE(back.at("offers").at(2).at("name").get<std::string>().find(u8"·再演"), std::string::npos);
    EXPECT_EQ(back.at("offers").at(3).at("id"), "proj_short_01");
}
TEST(Validation, NumericBoundsAndSchema) {
    const std::vector<std::function<void(Json&)>> mutations = {
        [](Json& s) { s["version"] = 2; },
        [](Json& s) { s["company"]["funds"] = -1; },
        [](Json& s) { s["seed"] = 4294967296ULL; },
        [](Json& s) { s["company"]["week"] = 521; },
        [](Json& s) { s["phase"] = "event_pending"; },
        [](Json& s) { s["company"]["end_reason"] = "voluntary"; },
        [](Json& s) { s["company"]["status"] = "closing"; },
        [](Json& s) { s["company"]["status"] = "ended"; },
        [](Json& s) { s["company"]["status"] = "closing"; s["company"]["end_reason"] = "time_limit"; },
        [](Json& s) { s["company"]["staff"][0]["id"] = "staff_99"; },
        [](Json& s) { s["company"]["staff"][0]["weekly_salary"] = 1000; },
        [](Json& s) { s["company"]["staff"][0]["morale"] = 101; },
        [](Json& s) { s["company"]["staff"][1]["abilities"]["drawing"] = 1; },
        [](Json& s) { s["company"]["staff"][2]["clues"] = Json::array(); },
        [](Json& s) { s["project"]["mode"] = "committee"; },
        [](Json& s) { s["project"]["investment_percent"] = 5; },
        [](Json& s) { s["project"]["current_stage"] = "unknown"; },
        [](Json& s) { s["project"]["stages"]["postproduction"]["status"] = "ready"; },
        [](Json& s) { s["project"]["stages"]["script"]["work_done"] = 31; },
        [](Json& s) { s["project"]["delivery_reason"] = "completed"; },
        [](Json& s) { s["project"]["extension_count"] = 1; },
        [](Json& s) { s["project"]["committee_pressure"] = Json::object(); },
        [](Json& s) { s["project"]["temporary_staff"] = Json::array({Json::object()}); },
        [](Json& s) { s["project"]["outsourcing"] = Json::array({Json::object()}); },
        [](Json& s) { s["project"]["finance"]["costs"]["events"] = 1; },
        [](Json& s) { s["project"]["finance"]["investment_paid"] = 1; },
        [](Json& s) { s["project"]["finance"]["commercial_share_received"] = 1; },
        [](Json& s) { s["project"]["start_week"] = 3; },
        [](Json& s) { s["project"]["offer"]["contract_budget"] = 1; },
        [](Json& s) { s["project"] = nullptr; },
        [](Json& s) { s["pending_event"] = Json::object(); },
        [](Json& s) { s["recruitment_pool"] = Json::array({Json::object()}); },
        [](Json& s) { s["suppliers"] = Json::array({Json::object()}); },
        [](Json& s) { s["preview"] = Json::object(); },
        [](Json& s) { s["company_result"] = Json::object(); },
        [](Json& s) { s["last_project_id"] = "proj_ova_01"; }
    };
    for (const auto& mutate : mutations) {
        auto state = start(); mutate(state);
        for (auto method : {apc::start_project, apc::apply_decision, apc::advance_week, apc::resolve_event, apc::calculate_result})
            expect_error(method(Json{{"state", state}}.dump()), "INVALID_INPUT");
    }
    const std::vector<std::function<void(Json&)>> idle_mutations = {
        [](Json& s) { s["offers"][0]["id"] = "unknown"; },
        [](Json& s) { s["offers"][0]["allowed_modes"] = Json::array({"contract", "committee"}); },
        [](Json& s) { s["offers"][1]["id"] = s["offers"][0]["id"]; },
        [](Json& s) { s["offers"].erase(0); },
        [](Json& s) { s["offers"][2]["total_investment"] = 1; },
        [](Json& s) { s["preview"]["total_cost"] = 99999; }
    };
    for (const auto& mutate : idle_mutations) {
        auto state = initialize(); mutate(state);
        for (auto method : {apc::start_project, apc::apply_decision, apc::advance_week, apc::resolve_event, apc::calculate_result})
            expect_error(method(Json{{"state", state}}.dump()), "INVALID_INPUT");
    }
    const std::vector<std::function<void(Json&)>> settled_mutations = {
        [](Json& s) { s["history"][0]["profit"] = max_i + 1; },
        [](Json& s) { s["history"][0]["id"] = "unknown"; },
        [](Json& s) { s["history"][0]["end_week"] = 999; },
        [](Json& s) { s["history"][0]["previous_work_id"] = "proj_tv_01"; },
        [](Json& s) { s["history"][0]["mode"] = "committee"; },
        [](Json& s) { s["last_project_id"] = nullptr; },
        [](Json& s) { s["phase"] = "idle"; }
    };
    for (const auto& mutate : settled_mutations) {
        auto state = settledBase(); mutate(state);
        for (auto method : {apc::start_project, apc::apply_decision, apc::advance_week, apc::resolve_event, apc::calculate_result})
            expect_error(method(Json{{"state", state}}.dump()), "INVALID_INPUT");
    }
}
TEST(Validation, SafeIntegerBoundariesRemainAtomic) {
    auto idle = initialize(); idle["company"]["funds"] = max_i;
    EXPECT_EQ(advance(idle).at("state").at("company").at("funds"), max_i - 180000);
    auto rich = initialize(); rich["company"]["funds"] = max_i;
    expect_error(apc::start_project(Json{{"state", rich}, {"offer_id", "proj_ova_01"}, {"mode", "contract"}, {"investment_percent", 0}}.dump()), "INVALID_INPUT");
    auto state = start(); state["company"]["week"] = max_i - 1;
    expect_error(apc::advance_week(Json{{"state", state}}.dump()), "INVALID_INPUT");
}
class InvalidInput : public testing::TestWithParam<std::string> {};
TEST_P(InvalidInput, AllSixBoundariesReturnStructuredErrors) {
    for (auto method : {apc::initialize_game, apc::start_project, apc::apply_decision, apc::advance_week, apc::resolve_event, apc::calculate_result})
        EXPECT_NO_THROW(expect_error(method(GetParam()), "INVALID_INPUT"));
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

// ---------- M2 #7 招募行为（提案 1 + 模板库修订）----------
namespace {
Json scout(const Json& state, const char* type = "scout", const Json& extra = Json::object()) {
    Json decision{{"type", type}};
    for (const auto& item : extra.items()) decision[item.key()] = item.value();
    return call(apc::apply_decision, {{"state", state}, {"decision", decision}}).at("state");
}
Json hire(const Json& state, const std::string& id) {
    return call(apc::apply_decision, {{"state", state}, {"decision", {{"type", "hire_core"}, {"candidate_id", id}}}}).at("state");
}
int sum_of(const Json& person) {
    int total = 0;
    for (auto ability : apc::rules::abilities) total += person.at("abilities").at(ability).get<int>();
    return total;
}
int band_of_sum(int sum) { return sum < 240 ? 0 : sum < 320 ? 1 : sum < 400 ? 2 : 3; }
Json with_pity(const Json& state, int sr, int ssr) {
    auto copy = state;
    copy["company"]["scout_pity"] = {{"since_sr", sr}, {"since_ssr", ssr}};
    return copy;
}
}
TEST(Recruit, ReplayIdenticalAndExactly48SeedSteps) {
    const auto base = initialize(12345);
    const auto a = scout(base);
    const auto b = scout(base);
    EXPECT_EQ(a.at("recruitment_pool"), b.at("recruitment_pool"));
    EXPECT_EQ(a.at("seed"), b.at("seed"));
    std::uint32_t expected = 12345;
    for (int i = 0; i < 48; ++i) expected = expected * apc::rules::rng_multiplier + apc::rules::rng_increment;
    EXPECT_EQ(a.at("seed").get<std::uint64_t>(), expected);
    EXPECT_EQ(a.at("recruitment_pool").size(), 3U);
}
TEST(Recruit, FeeLedgerAndPreviewUnchanged) {
    const auto state = scout(initialize());
    EXPECT_EQ(state.at("company").at("funds"), 2000000 - 150000);
    EXPECT_EQ(state.at("company").at("finance").at("costs").at("operations"), 150000);
    EXPECT_EQ(state.at("company").at("finance").at("costs").at("salary"), 0);
    EXPECT_EQ(state.at("preview").at("total_cost"), 180000);
    const auto targeted = scout(initialize(), "targeted_scout", {{"role", "animator"}});
    EXPECT_EQ(targeted.at("company").at("funds"), 2000000 - 400000);
    EXPECT_EQ(targeted.at("company").at("finance").at("costs").at("operations"), 400000);
}
TEST(Recruit, PhaseAndTargetedParamGuards) {
    expect_error(apc::apply_decision(Json{{"state", start()}, {"decision", {{"type", "scout"}}}}.dump()), "INVALID_PHASE");
    expect_error(apc::apply_decision(Json{{"state", initialize()}, {"decision", {{"type", "targeted_scout"}, {"role", "animator"}, {"focus_ability", "drawing"}}}}.dump()), "INVALID_INPUT");
    expect_error(apc::apply_decision(Json{{"state", initialize()}, {"decision", {{"type", "targeted_scout"}}}}.dump()), "INVALID_INPUT");
    expect_error(apc::apply_decision(Json{{"state", initialize()}, {"decision", {{"type", "targeted_scout"}, {"role", "nope"}}}}.dump()), "INVALID_INPUT");
}
TEST(Recruit, InsufficientFundsKeepsStateAndSeed) {
    auto poor = initialize();
    poor["company"]["funds"] = 100000;
    expect_error(apc::apply_decision(Json{{"state", poor}, {"decision", {{"type", "scout"}}}}.dump()), "INSUFFICIENT_BUDGET");
    EXPECT_EQ(poor.at("seed"), 12345);
    EXPECT_TRUE(poor.at("recruitment_pool").empty());
}
TEST(Recruit, PityTenthForcesSrAndResets) {
    const auto state = scout(with_pity(initialize(), 9, 0));
    EXPECT_GE(sum_of(state.at("recruitment_pool").at(2)), 320);
    EXPECT_EQ(state.at("company").at("scout_pity").at("since_sr"), 0);
    const auto ninth = scout(with_pity(initialize(), 8, 0));
    const auto& pity = ninth.at("company").at("scout_pity");
    bool any_sr = false;
    for (const auto& person : ninth.at("recruitment_pool")) any_sr = any_sr || sum_of(person) >= 320;
    EXPECT_EQ(pity.at("since_sr"), any_sr ? 0 : 9);
}
TEST(Recruit, PityFiftiethForcesSsr) {
    const auto state = scout(with_pity(initialize(), 0, 49));
    EXPECT_GE(sum_of(state.at("recruitment_pool").at(2)), 400);
    EXPECT_EQ(state.at("company").at("scout_pity").at("since_ssr"), 0);
}
TEST(Recruit, HireMovesCandidateAndSalaryEntersPreview) {
    const auto scouted = scout(initialize());
    const auto& candidate = scouted.at("recruitment_pool").at(0);
    const auto salary = candidate.at("weekly_salary").get<std::int64_t>();
    EXPECT_GE(salary, 15000 + sum_of(candidate) * 90);
    const auto hired = hire(scouted, candidate.at("id").get<std::string>());
    EXPECT_EQ(hired.at("company").at("staff").size(), 5U);
    EXPECT_EQ(hired.at("recruitment_pool").size(), 2U);
    EXPECT_EQ(hired.at("company").at("staff").at(4).at("id"), candidate.at("id"));
    EXPECT_EQ(hired.at("preview").at("total_cost"), 180000 + salary);
}
TEST(Recruit, CoreCapEightRejectsNinth) {
    auto state = initialize();
    state = scout(state);
    std::vector<std::string> ids;
    for (const auto& person : state.at("recruitment_pool")) ids.push_back(person.at("id").get<std::string>());
    for (const auto& id : ids) state = hire(state, id);
    state = scout(state);
    state = hire(state, state.at("recruitment_pool").at(0).at("id").get<std::string>());
    EXPECT_EQ(state.at("company").at("staff").size(), 8U);
    state = scout(state);
    expect_error(apc::apply_decision(Json{{"state", state}, {"decision", {{"type", "hire_core"}, {"candidate_id", state.at("recruitment_pool").at(0).at("id")}}}}.dump()), "CAPACITY_EXCEEDED");
}
TEST(Recruit, TargetedPoolMatchesRoleOrFocus) {
    const auto by_role = scout(initialize(), "targeted_scout", {{"role", "animator"}});
    for (const auto& person : by_role.at("recruitment_pool")) EXPECT_EQ(person.at("role"), "animator");
    const auto by_focus = scout(initialize(), "targeted_scout", {{"focus_ability", "postproduction"}});
    for (const auto& person : by_focus.at("recruitment_pool")) EXPECT_EQ(person.at("role"), "postproduction");
}
TEST(Recruit, NamesUniqueAndPoolReplaces) {
    auto state = scout(initialize());
    const auto first_ids = state.at("recruitment_pool");
    for (const auto& person : first_ids) state = hire(state, person.at("id").get<std::string>());
    state = scout(state);
    EXPECT_EQ(state.at("recruitment_pool").size(), 3U);
    std::set<std::string> names;
    for (const auto& person : state.at("company").at("staff")) EXPECT_TRUE(names.insert(person.at("name").get<std::string>()).second);
    for (const auto& person : state.at("recruitment_pool")) EXPECT_TRUE(names.insert(person.at("name").get<std::string>()).second);
    for (const auto& person : state.at("recruitment_pool"))
        for (const auto& old : first_ids) EXPECT_NE(person.at("id"), old.at("id"));
}
TEST(Recruit, BandsTemplatesAndPotentialInvariants) {
    for (auto seed : {1U, 2U, 42U, 12345U, 99999U, 0xffffffffU}) {
        const auto state = scout(initialize(seed));
        for (const auto& person : state.at("recruitment_pool")) {
            const auto band = band_of_sum(sum_of(person));
            for (auto ability : apc::rules::abilities) {
                EXPECT_LE(person.at("abilities").at(ability).get<int>(), 100);
                EXPECT_GE(person.at("potential").at(ability).get<int>(), person.at("abilities").at(ability).get<int>());
            }
            if (band == 0) EXPECT_EQ(person.at("talent_type"), "ordinary");
            if (band == 3) EXPECT_NE(person.at("talent_type"), "ordinary");
            EXPECT_EQ(person.at("clues").size(), 2U);
        }
    }
}
TEST(Recruit, HiredStaffProduceAndRaiseSalary) {
    auto state = scout(initialize());
    state = hire(state, state.at("recruitment_pool").at(0).at("id").get<std::string>());
    const auto hired_id = state.at("company").at("staff").at(4).at("id").get<std::string>();
    const auto old_salary = state.at("company").at("staff").at(4).at("weekly_salary").get<std::int64_t>();
    state = call(apc::apply_decision, {{"state", state}, {"decision", {{"type", "raise_salary"}, {"staff_id", hired_id}, {"weekly_salary", old_salary + 1000}}}}).at("state");
    EXPECT_EQ(state.at("company").at("staff").at(4).at("weekly_salary"), old_salary + 1000);
    state = call(apc::start_project, {{"state", state}, {"offer_id", "proj_ova_01"}, {"mode", "contract"}, {"investment_percent", 0}}).at("state");
    state = configure(state);
    const auto report = advance(state);
    EXPECT_EQ(report.at("report").at("staff_deltas").size(), 5U);
}
TEST(Recruit, SaveRoundtripKeepsPoolAndPity) {
    auto state = scout(with_pity(initialize(), 3, 7));
    state = hire(state, state.at("recruitment_pool").at(0).at("id").get<std::string>());
    const auto restored = Json::parse(state.dump());
    EXPECT_EQ(restored, state);
    const auto again = scout(restored);
    EXPECT_EQ(again.at("recruitment_pool").size(), 3U);
    EXPECT_EQ(restored.at("company").at("scout_pity"), state.at("company").at("scout_pity"));
}
