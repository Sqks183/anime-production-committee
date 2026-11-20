#pragma once

#include <array>
#include <cstdint>
#include <nlohmann/json.hpp>

namespace apc::rules {
inline constexpr std::int64_t max_integer = 9007199254740991LL;
inline constexpr std::uint64_t max_seed = 4294967295ULL;
inline constexpr int version = 2;
inline constexpr std::int64_t initial_funds = 2000000;
inline constexpr int initial_morale = 80;
inline constexpr int initial_reputation = 0;
inline constexpr std::int64_t fixed_cost = 120000;
inline constexpr std::int64_t salary = 45000;
inline constexpr std::int64_t overtime_cost = 25000;
inline constexpr std::int64_t outsource_cost = 500000;
inline constexpr int outsource_progress = 8;
inline constexpr int outsource_quality = 50;
inline constexpr int base_speed = 9;
inline constexpr int specialty = 1200;
inline constexpr int nonspecialty = 800;
inline constexpr int morale_base = 600;
inline constexpr int morale_scale = 4;
inline constexpr int overtime_speed = 1300;
inline constexpr int overtime_quality = 900;
inline constexpr int overtime_morale = 6;
inline constexpr int rest_morale = 10;
inline constexpr int rework_threshold = 45;
inline constexpr int rework_progress = 4;
inline constexpr int event_chance = 150;
inline constexpr int overtime_event_chance = 50;
inline constexpr int deadline_revenue = 600;
inline constexpr int below_target_revenue = 700;
inline constexpr int success_reputation = 10;
inline constexpr int failure_reputation = -5;
inline constexpr int over_budget_reputation = -3;
inline constexpr std::uint32_t rng_multiplier = 1664525U;
inline constexpr std::uint32_t rng_increment = 1013904223U;
inline constexpr std::array<const char*, 3> stages{"pre", "mid", "post"};
inline constexpr std::array<int, 3> quality_weights{300, 400, 300};
inline constexpr std::array<int, 4> grade_thresholds{85, 75, 65, 50};
inline constexpr std::array<const char*, 5> grades{"S", "A", "B", "C", "D"};
struct Policy { const char* id; int speed; int quality; int morale; };
inline constexpr std::array<Policy, 3> policies{{{"rush", 1300, 800, 5}, {"normal", 1000, 1000, 1}, {"polish", 750, 1200, 1}}};
struct Staff { const char* id; const char* name; const char* role; const char* stage; int skill; };
inline constexpr std::array<Staff, 4> staff{{
    {"staff_01", u8"林导演", "director", "pre", 70},
    {"staff_02", u8"陈原画", "key_animator", "mid", 75},
    {"staff_03", u8"许动画", "animator", "mid", 55},
    {"staff_04", u8"周摄影", "photographer", "post", 65}
}};
struct Offer { const char* id; const char* name; const char* type; std::int64_t budget; int duration; int quality; int reputation; int speed; };
inline constexpr std::array<Offer, 3> offers{{
    {"proj_ova_01", u8"放学后的第七帧", "ova", 8000000, 20, 60, 0, 1000},
    {"proj_tv_01", u8"星轨列车", "tv", 14000000, 26, 68, 0, 850},
    {"proj_movie_01", u8"未寄出的夏天", "movie", 24000000, 30, 78, 20, 700}
}};
inline nlohmann::json events() {
    return nlohmann::json::array({
        {{"id", "evt_001"}, {"title", u8"原画支援请求"}, {"description", u8"伙伴工作室可以支援，也可以让团队休整后继续。"}, {"options", {
            {{"id", "opt_a"}, {"label", u8"购买支援：资金 -300,000，士气 +8"}, {"effect", {{"funds", -300000}, {"morale", 8}}}},
            {{"id", "opt_b"}, {"label", u8"协商延期：截止日 +1，中期质量 -3"}, {"effect", {{"deadline_days", 1}, {"stage_quality", {{"stage", "mid"}, {"delta", -3}}}}}}
        }}},
        {{"id", "evt_002"}, {"title", u8"临时修改分镜"}, {"description", u8"资方希望提升表现力，需要在质量与资源间选择。"}, {"options", {
            {{"id", "opt_a"}, {"label", u8"接受修改：前期质量 +5，士气 -5"}, {"effect", {{"stage_quality", {{"stage", "pre"}, {"delta", 5}}}, {"morale", -5}}}},
            {{"id", "opt_b"}, {"label", u8"简化镜头：前期质量 -4，士气 +5"}, {"effect", {{"stage_quality", {{"stage", "pre"}, {"delta", -4}}}, {"morale", 5}}}}
        }}},
        {{"id", "evt_003"}, {"title", u8"摄影设备维护"}, {"description", u8"设备出现色偏，可以购买校准或由员工赶修。"}, {"options", {
            {{"id", "opt_a"}, {"label", u8"专业校准：资金 -200,000，后期质量 +4"}, {"effect", {{"funds", -200000}, {"stage_quality", {{"stage", "post"}, {"delta", 4}}}}}},
            {{"id", "opt_b"}, {"label", u8"内部赶修：士气 -6，后期质量 -2"}, {"effect", {{"morale", -6}, {"stage_quality", {{"stage", "post"}, {"delta", -2}}}}}}
        }}}
    });
}
}
