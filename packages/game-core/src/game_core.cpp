#include "game_core.hpp"

#include <algorithm>
#include <cstdint>
#include <nlohmann/json.hpp>

namespace apc {
namespace {
using Json = nlohmann::json;
constexpr std::uint64_t kMaxSafeInteger = 9007199254740991ULL;
constexpr std::uint64_t kMaxSeed = 4294967295ULL;
constexpr std::uint64_t kDailyCost = 5000;
constexpr std::uint64_t kDailyProgress = 5;

std::string error(const char* code, const char* message) {
    return Json{{"error", {{"code", code}, {"message", message}}}}.dump();
}

bool read_integer(const Json& object, const char* key, std::uint64_t maximum,
                  std::uint64_t& value) {
    const auto it = object.find(key);
    if (it == object.end() || !it->is_number_integer()) {
        return false;
    }
    if (it->is_number_unsigned()) {
        value = it->get<std::uint64_t>();
    } else {
        const auto signed_value = it->get<std::int64_t>();
        if (signed_value < 0) {
            return false;
        }
        value = static_cast<std::uint64_t>(signed_value);
    }
    return value <= maximum;
}

std::string not_implemented() {
    return R"({"error":{"code":"NOT_IMPLEMENTED","message":"This operation is reserved and not implemented."}})";
}
}  // namespace

std::string advance_day(std::string input) {
    try {
        const auto state = Json::parse(input);
        std::uint64_t budget = 0;
        std::uint64_t progress = 0;
        std::uint64_t seed = 0;
        if (!state.is_object() ||
            !read_integer(state, "budget", kMaxSafeInteger, budget) ||
            !read_integer(state, "progress", 100, progress) ||
            !read_integer(state, "seed", kMaxSeed, seed)) {
            return error("INVALID_INPUT",
                         "Expected an object with integer budget (0..9007199254740991), "
                         "progress (0..100), and seed (0..4294967295).");
        }

        // The seed is validated but intentionally unused by this deterministic prototype.
        if (progress < 100) {
            if (budget < kDailyCost) {
                return error("INSUFFICIENT_BUDGET", "Advancing a day requires a budget of 5000.");
            }
            budget -= kDailyCost;
            progress = std::min<std::uint64_t>(100, progress + kDailyProgress);
        }
        return Json{{"budget", budget}, {"progress", progress},
                    {"message", u8"制作进度已更新"}}.dump();
    } catch (const Json::exception&) {
        return error("INVALID_INPUT", "Input must be valid JSON with supported integer values.");
    } catch (...) {
        return R"({"error":{"code":"INTERNAL_ERROR","message":"An internal error occurred."}})";
    }
}

std::string initialize_game(std::string) { return not_implemented(); }
std::string start_project(std::string) { return not_implemented(); }
std::string apply_decision(std::string) { return not_implemented(); }
std::string resolve_event(std::string) { return not_implemented(); }
std::string calculate_result(std::string) { return not_implemented(); }

}  // namespace apc
