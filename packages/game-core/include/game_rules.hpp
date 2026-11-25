#pragma once

#include <array>
#include <cstdint>
#include <nlohmann/json.hpp>

namespace apc::rules {

inline constexpr std::int64_t max_integer = 9007199254740991LL;
inline constexpr std::uint64_t max_seed = 4294967295ULL;
inline constexpr int version = 3;
inline constexpr int max_weeks = 520;

// TODO(待定)：以下均为 M1 暂定值，等待团队实测平衡。
inline constexpr std::int64_t initial_funds = 2000000;
inline constexpr std::int64_t operations_weekly = 30000;
inline constexpr std::int64_t stage_cost = 30000;
inline constexpr std::int64_t overtime_cost = 25000;
inline constexpr std::int64_t contract_share_permille = 200;   // 合同预算 = floor(total × 20%)
inline constexpr std::int64_t deadline_penalty_permille = 200;  // 违约交付扣合同额 20%
inline constexpr std::int64_t closed_penalty_permille = 100;    // 公司关闭中断扣合同额 10%
inline constexpr int success_reputation = 10;
inline constexpr int below_target_reputation = 3;
inline constexpr int deadline_reputation = -5;
inline constexpr int rating_renowned = 20000000;
inline constexpr int rating_stable = 5000000;
inline constexpr int rating_small = 0;

inline constexpr int initial_morale = 80;
inline constexpr int initial_fatigue = 0;
inline constexpr int initial_reputation = 0;
inline constexpr int base_speed = 9;
inline constexpr int specialty_fit = 1200;
inline constexpr int nonspecialty_fit = 800;
inline constexpr int morale_base = 600;
inline constexpr int morale_scale = 4;
inline constexpr int fatigue_penalty = 4;
inline constexpr int fatigue_work = 4;
inline constexpr int fatigue_rest = 8;
inline constexpr int rest_morale = 10;
inline constexpr int overtime_morale = 6;
inline constexpr int carry_over_permille = 600;  // 阶段质量上限 = 前阶段×60% + 40
inline constexpr int carry_over_offset = 40;
inline constexpr std::uint32_t rng_multiplier = 1664525U;
inline constexpr std::uint32_t rng_increment = 1013904223U;

inline constexpr std::array<const char*, 5> stages{"script", "storyboard", "key_animation", "animation_check", "postproduction"};
inline constexpr std::array<const char*, 6> abilities{"planning", "direction", "drawing", "animation", "management", "postproduction"};
// 每阶段的需求专业，与 stages 对齐。
inline constexpr std::array<int, 5> stage_ability{0, 1, 2, 3, 5};
inline constexpr std::array<int, 5> quality_weights{150, 200, 250, 200, 200};
inline constexpr std::array<int, 5> experience_gain{2, 2, 2, 2, 2};  // TODO(待定)：正式成长规则属 #8。

struct Policy { const char* id; int speed; int quality; int morale; int cost; };
inline constexpr std::array<Policy, 3> policies{{
    {"quality", 750, 1250, -1, 1100},
    {"balanced", 1000, 1000, -2, 1000},
    {"deadline", 1300, 800, -4, 900}
}};

struct ScaleRule { const char* scale; std::int64_t revenue_per_point; };
inline constexpr std::array<ScaleRule, 4> scales{{
    {"ova", 15000}, {"short", 8000}, {"tv", 40000}, {"movie", 100000}
}};

struct StaffSpec {
    const char* id; const char* name; const char* role; const char* specialty;
    std::int64_t weekly_salary; std::array<int, 6> abilities; std::array<int, 6> potential;
    const char* talent_type; const char* clue;
};
inline constexpr std::array<StaffSpec, 4> staff{{
    {"staff_01", u8"林导演", "director", "direction", 45000, {70, 75, 45, 40, 65, 40}, {90, 95, 70, 65, 85, 65}, "specialist", u8"善于分镜调度"},
    {"staff_02", u8"陈原画", "key_animator", "drawing", 38000, {45, 50, 80, 70, 40, 45}, {70, 75, 95, 90, 65, 70}, "specialist", u8"擅长动作设计"},
    {"staff_03", u8"许动画", "animator", "animation", 32000, {40, 45, 60, 65, 40, 50}, {65, 70, 80, 85, 60, 70}, "uneven", u8"出画速度快"},
    {"staff_04", u8"周摄影", "postproduction", "postproduction", 35000, {40, 45, 50, 50, 45, 70}, {60, 65, 70, 70, 60, 92}, "generalist", u8"合成审美稳定"}
}};

struct OfferSpec {
    const char* id; const char* name; const char* source; const char* scale;
    std::int64_t total_investment; int duration_weeks; int target_quality;
    int audience_base; int commercial_potential; const char* risk;
    std::array<int, 5> workloads;
};
// M1 固定企划目录；正式生成规则属 #6。original 源不参与 M1。
inline constexpr std::array<OfferSpec, 12> offers{{
    {"proj_ova_01", u8"放学后的第七帧", "manga", "ova", 20000000, 14, 60, 55, 60, "low", {30, 30, 30, 30, 30}},
    {"proj_short_01", u8"纸飞机电台", "light_novel", "short", 12000000, 9, 50, 40, 45, "low", {20, 20, 20, 20, 20}},
    {"proj_tv_01", u8"星轨列车", "game", "tv", 30000000, 24, 68, 75, 70, "medium", {55, 55, 55, 55, 55}},
    {"proj_ova_02", u8"海雾信号站", "light_novel", "ova", 22000000, 15, 62, 50, 65, "medium", {34, 34, 34, 34, 34}},
    {"proj_short_02", u8"便利贴宇宙", "manga", "short", 14000000, 10, 55, 45, 50, "low", {24, 24, 24, 24, 24}},
    {"proj_tv_02", u8"霓虹食单", "light_novel", "tv", 36000000, 28, 70, 80, 75, "medium", {65, 65, 65, 65, 65}},
    {"proj_ova_03", u8"夜行校线", "game", "ova", 24000000, 16, 65, 60, 70, "medium", {38, 38, 38, 38, 38}},
    {"proj_movie_01", u8"云端灯塔", "game", "movie", 80000000, 40, 80, 90, 95, "high", {110, 110, 110, 110, 110}},
    {"proj_short_03", u8"便利屋手记", "light_novel", "short", 16000000, 11, 58, 50, 55, "low", {26, 26, 26, 26, 26}},
    {"proj_tv_03", u8"潮汐图书馆", "manga", "tv", 40000000, 30, 72, 85, 78, "high", {70, 70, 70, 70, 70}},
    {"proj_ova_04", u8"雨日放映室", "manga", "ova", 18000000, 13, 58, 48, 55, "low", {28, 28, 28, 28, 28}},
    {"proj_movie_02", u8"群山回响", "light_novel", "movie", 90000000, 45, 82, 92, 96, "high", {125, 125, 125, 125, 125}}
}};

inline std::int64_t contract_budget(std::int64_t total_investment) { return total_investment * contract_share_permille / 1000; }

// ---------- M2 #7 招募行为参数（提案 1 + 模板库修订，2026-11-22）----------
// TODO(待定)：全部为 M2 提案推荐值，等首局实测校准；来源见议题 #7 提案评论。
inline constexpr std::int64_t scout_fee = 150000;
inline constexpr std::int64_t targeted_scout_fee = 400000;
inline constexpr int scout_candidates = 3;
inline constexpr int core_staff_cap = 8;
inline constexpr int pity_sr = 10;
inline constexpr int pity_ssr = 50;
inline constexpr int salary_base = 15000;
inline constexpr int salary_per_point = 90;
inline constexpr std::array<int, 3> band_floor{{240, 320, 400}};  // N<240 R<320 SR<400 SSR>=400
inline constexpr std::array<int, 4> band_chance{{550, 300, 120, 30}};  // 声望 100 基础千分比
inline constexpr int reputation_shift_step = 200;
inline constexpr int reputation_shift_permille = 20;
struct BandRange { int lo; int hi; };
inline constexpr std::array<BandRange, 4> band_range{{{{20, 45}, {35, 60}, {50, 75}, {65, 90}}}};

inline constexpr std::array<const char*, 7> roles{{"director", "scriptwriter", "animation_director", "key_animator", "animator", "production_manager", "postproduction"}};
inline constexpr std::array<int, 7> role_ability{{1, 0, 1, 2, 3, 4, 5}};

struct RecruitTemplate {
    const char* id; int bands; const char* talent; int spike; int boost; int penalty;
    int potential_lo; int potential_hi; int salary_permille; const char* clue1; const char* clue2;
};
// spike: 固定专业索引；-1 平坦；-2 取生成后最高维。bands 为位掩码 N=1 R=2 SR=4 SSR=8。
inline constexpr std::array<RecruitTemplate, 8> templates{{
    {"mass_fry", 1, "ordinary", -1, 0, 0, 10, 30, 1000, u8"作品集全是模板切", u8"面试答得流利但问深就卡"},
    {"rookie", 6, "uneven", -2, 15, 0, 10, 30, 1000, u8"某一段明显高于其余水平", u8"手感生涩但眼里有活"},
    {"veteran", 6, "generalist", -1, 0, 0, 10, 30, 1000, u8"什么工序都接过什么都能顶", u8"报价单比作品集厚"},
    {"genius", 12, "uneven", -2, 25, 10, 10, 30, 1000, u8"试稿惊艳但协作评价两极", u8"只肯画自己感兴趣的卡"},
    {"late_bloom", 3, "specialist", -1, 0, 0, 30, 45, 1000, u8"现在的手笔看不出将来", u8"笔记比成品认真"},
    {"desk", 6, "generalist", 4, 15, 0, 10, 30, 1000, u8"排期表做得比作品好看", u8"群里永远第一个回复"},
    {"post_otaku", 6, "specialist", 5, 15, 0, 10, 30, 1000, u8"合成demo审美在线", u8"沟通靠邮件"},
    {"freelance", 6, "specialist", -2, 10, 0, 10, 30, 1100, u8"履历漂亮但报价也漂亮", u8"档期排到明年"}
}};

inline constexpr std::array<const char*, 20> surnames{{u8"林", u8"陈", u8"许", u8"周", u8"苏", u8"叶", u8"顾", u8"沈", u8"陆", u8"江", u8"苗", u8"白", u8"秦", u8"唐", u8"宋", u8"韩", u8"冯", u8"邓", u8"曹", u8"彭"}};
inline constexpr std::array<const char*, 20> given_names{{u8"一满", u8"知秋", u8"望舒", u8"启明", u8"小满", u8"景行", u8"昭野", u8"汀兰", u8"未明", u8"吹夏", u8"星回", u8"屿舟", u8"南枝", u8"北落", u8"冬升", u8"西来", u8"望川", u8"知夏", u8"既白", u8"初心"}};

}  // namespace apc::rules
