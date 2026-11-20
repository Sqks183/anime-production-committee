#include "game_core.hpp"

#include <string>
#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

namespace {
using Json = nlohmann::json;

Json advance(const Json& input) {
    return Json::parse(apc::advance_day(input.dump()));
}

void expect_error(const std::string& output, const char* code) {
    const auto result = Json::parse(output);
    ASSERT_TRUE(result.is_object());
    ASSERT_EQ(result.size(), 1U);
    ASSERT_TRUE(result.contains("error"));
    ASSERT_TRUE(result["error"].is_object());
    ASSERT_EQ(result["error"].size(), 2U);
    EXPECT_EQ(result["error"]["code"], code);
    ASSERT_TRUE(result["error"]["message"].is_string());
    EXPECT_FALSE(result["error"]["message"].get<std::string>().empty());
}

TEST(AdvanceDay, ExactExampleAndInputUnchanged) {
    const std::string input = R"({"budget":100000,"progress":20,"seed":12345})";
    const auto before = input;
    const Json expected = {{"budget", 95000}, {"progress", 25},
                           {"message", u8"制作进度已更新"}};
    EXPECT_EQ(Json::parse(apc::advance_day(input)), expected);
    EXPECT_EQ(input, before);
}

TEST(AdvanceDay, ExactBudgetAndZeroSeed) {
    const auto result = advance({{"budget", 5000}, {"progress", 0}, {"seed", 0}});
    EXPECT_EQ(result["budget"], 0);
    EXPECT_EQ(result["progress"], 5);
}

TEST(AdvanceDay, ClampsProgressAndChargesOnlyOnce) {
    for (int progress = 95; progress < 100; ++progress) {
        const auto result = advance({{"budget", 10000}, {"progress", progress}, {"seed", 1}});
        EXPECT_EQ(result["budget"], 5000);
        EXPECT_EQ(result["progress"], 100);
        auto next = result;
        next["seed"] = 1;
        EXPECT_EQ(advance(next), result);
    }
}

TEST(AdvanceDay, CompleteNeverChargesEvenWhenBudgetIsEmpty) {
    for (const auto budget : {0ULL, 4999ULL, 5000ULL, 9007199254740991ULL}) {
        const auto result = advance({{"budget", budget}, {"progress", 100}, {"seed", 0}});
        EXPECT_EQ(result["budget"], budget);
        EXPECT_EQ(result["progress"], 100);
    }
}

TEST(AdvanceDay, MaximumSafeBudgetAndUint32Seed) {
    const auto result = advance({{"budget", 9007199254740991ULL},
                                 {"progress", 20}, {"seed", 4294967295ULL}});
    EXPECT_EQ(result["budget"], 9007199254735991ULL);
    EXPECT_EQ(result["progress"], 25);
}

TEST(AdvanceDay, InsufficientBudgetIsStructuredAndNonMutating) {
    for (const auto budget : {0, 1, 4999}) {
        const auto input = Json{{"budget", budget}, {"progress", 99}, {"seed", 12345}}.dump();
        const auto before = input;
        expect_error(apc::advance_day(input), "INSUFFICIENT_BUDGET");
        EXPECT_EQ(input, before);
    }
}

class InvalidInput : public testing::TestWithParam<std::string> {};
TEST_P(InvalidInput, ReturnsStructuredErrorWithoutThrowing) {
    const auto input = GetParam();
    SCOPED_TRACE(input);
    EXPECT_NO_THROW(expect_error(apc::advance_day(input), "INVALID_INPUT"));
}

INSTANTIATE_TEST_SUITE_P(JsonAndSchema, InvalidInput, testing::Values(
    "", "{", "undefined", "null", "true", "42", "\"text\"", "[]",
    "[100000,20,12345]", "{}",
    R"({"budget":100000,"progress":20})",
    R"({"progress":20,"seed":1})",
    R"({"budget":100000,"seed":1})",
    R"({"budget":-1,"progress":20,"seed":1})",
    R"({"budget":9007199254740992,"progress":20,"seed":1})",
    R"({"budget":18446744073709551615,"progress":20,"seed":1})",
    R"({"budget":18446744073709551616,"progress":20,"seed":1})",
    R"({"budget":5000.5,"progress":20,"seed":1})",
    R"({"budget":5000.0,"progress":20,"seed":1})",
    R"({"budget":"100000","progress":20,"seed":1})",
    R"({"budget":true,"progress":20,"seed":1})",
    R"({"budget":null,"progress":20,"seed":1})",
    R"({"budget":[],"progress":20,"seed":1})",
    R"({"budget":{},"progress":20,"seed":1})",
    R"({"budget":1e1000,"progress":20,"seed":1})",
    R"({"budget":NaN,"progress":20,"seed":1})",
    R"({"budget":100000,"progress":-1,"seed":1})",
    R"({"budget":100000,"progress":101,"seed":1})",
    R"({"budget":100000,"progress":2.5,"seed":1})",
    R"({"budget":100000,"progress":"20","seed":1})",
    R"({"budget":100000,"progress":true,"seed":1})",
    R"({"budget":100000,"progress":null,"seed":1})",
    R"({"budget":100000,"progress":20,"seed":-1})",
    R"({"budget":100000,"progress":20,"seed":4294967296})",
    R"({"budget":100000,"progress":20,"seed":18446744073709551615})",
    R"({"budget":100000,"progress":20,"seed":1.5})",
    R"({"budget":100000,"progress":20,"seed":"1"})",
    R"({"budget":100000,"progress":20,"seed":true})",
    R"({"budget":100000,"progress":20,"seed":null})",
    R"({"budget":100000,"progress":100,"seed":-1})",
    R"({"budget":-1,"progress":100,"seed":1})",
    R"({"budget":0,"progress":20,"seed":-1})",
    R"({"budget":100000,"progress":20,"seed":1} trailing)",
    R"({"budget":100000,"progress":20,"seed":1,})"
));

TEST(AdvanceDay, InvalidUtf8IsCaught) {
    std::string input = R"({"budget":100000,"progress":20,"seed":1,"extra":")";
    input += static_cast<char>(0xFF);
    input += "\"}";
    expect_error(apc::advance_day(input), "INVALID_INPUT");
}

TEST(AdvanceDay, DeterministicAcrossRepeatedAndInterleavedCalls) {
    const std::string input = R"({"budget":100000,"progress":20,"seed":12345})";
    const auto expected = apc::advance_day(input);
    for (int i = 0; i < 100; ++i) {
        apc::advance_day(R"({"budget":8000,"progress":95,"seed":9})");
        apc::advance_day("invalid");
        EXPECT_EQ(apc::advance_day(input), expected);
    }
}

TEST(AdvanceDay, SeedDoesNotInventUnimplementedRandomBehavior) {
    Json input = {{"budget", 100000}, {"progress", 20}, {"seed", 0}};
    const auto expected = advance(input);
    for (const auto seed : {0ULL, 1ULL, 12345ULL, 4294967295ULL}) {
        input["seed"] = seed;
        EXPECT_EQ(advance(input), expected);
    }
}

TEST(AdvanceDay, ExtraFieldsDoNotChangePrototype) {
    const Json input = {{"budget", 100000}, {"progress", 20}, {"seed", 0},
                        {"dailyCost", 1}, {"progressGain", 90}};
    EXPECT_EQ(advance(input), (Json{{"budget", 95000}, {"progress", 25},
                                   {"message", u8"制作进度已更新"}}));
}

using ReservedFunction = std::string (*)(std::string);
class ReservedApi : public testing::TestWithParam<ReservedFunction> {};
TEST_P(ReservedApi, AlwaysExplicitlyNotImplemented) {
    for (const auto* input : {"{}", "invalid", "", "null",
                             R"({"budget":100000,"progress":20,"seed":12345})"}) {
        expect_error(GetParam()(input), "NOT_IMPLEMENTED");
    }
}
INSTANTIATE_TEST_SUITE_P(AllFiveMethods, ReservedApi, testing::Values(
    &apc::initialize_game, &apc::start_project, &apc::apply_decision,
    &apc::resolve_event, &apc::calculate_result
));
}  // namespace
