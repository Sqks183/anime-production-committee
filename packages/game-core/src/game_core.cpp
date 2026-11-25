#include "game_core.hpp"
#include "game_rules.hpp"

#include <algorithm>
#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace apc {
namespace {
using Json = nlohmann::json;
using Integer = std::int64_t;
struct ApiError { const char* code; const char* message; };
[[noreturn]] void invalid() { throw ApiError{"INVALID_INPUT", u8"经营数据或操作参数无效。"}; }
[[noreturn]] void wrong_phase() { throw ApiError{"INVALID_PHASE", u8"当前经营状态不允许此操作，请先处理待配置或待结算事项。"}; }
[[noreturn]] void locked() { throw ApiError{"STAGE_LOCKED", u8"阶段方案已锁定，阶段进行期间不能修改常规配置。"}; }
[[noreturn]] void not_allowed(const char* message) { throw ApiError{"MODE_NOT_ALLOWED", message}; }
[[noreturn]] void ended_company() { throw ApiError{"COMPANY_ENDED", u8"公司已进入结束流程，只能结清待交付项目或生成经营总结。"}; }
[[noreturn]] void insufficient() { throw ApiError{"INSUFFICIENT_BUDGET", u8"资金不足以支付本次可选动作，状态保持不变。"}; }
[[noreturn]] void capacity() { throw ApiError{"CAPACITY_EXCEEDED", u8"核心名册已达上限，不能再录用核心员工。"}; }
void require(bool condition) { if (!condition) invalid(); }
Integer number(const Json& value, Integer max = rules::max_integer, Integer min = 0) {
    require(value.is_number_integer());
    if (value.is_number_unsigned()) require(value.get<std::uint64_t>() <= static_cast<std::uint64_t>(max));
    const auto result = value.get<Integer>();
    require(result >= min && result <= max);
    return result;
}
Integer signed_number(const Json& value) { return number(value, rules::max_integer, -rules::max_integer); }
Integer num(const Json& value) { return number(value); }
Integer num(const Json& value, const char* key) { return number(value.at(key)); }
std::string text(const Json& value) { require(value.is_string()); return value.get<std::string>(); }
bool one_of(const Json& value, std::initializer_list<const char*> choices) {
    if (!value.is_string()) return false;
    for (auto choice : choices) if (value == choice) return true;
    return false;
}
Integer add(Integer a, Integer b) {
    require(b >= 0 && a <= rules::max_integer - b);
    return a + b;
}
Integer sub(Integer a, Integer b) {
    require(b >= 0 && a >= -rules::max_integer + b);
    return a - b;
}
Integer scale(Integer value, int permille) { return (value / 1000) * permille + (value % 1000) * permille / 1000; }
Integer clamp_score(Integer value) { return std::clamp<Integer>(value, 0, 100); }
std::uint32_t next_seed(std::uint32_t seed) { return seed * rules::rng_multiplier + rules::rng_increment; }
int stage_index(const std::string& stage) {
    for (std::size_t i = 0; i < rules::stages.size(); ++i) if (stage == rules::stages[i]) return static_cast<int>(i);
    invalid();
}

const rules::StaffSpec& staff_spec(const std::string& id) {
    for (const auto& item : rules::staff) if (id == item.id) return item;
    invalid();
}
std::string offer_base(const std::string& id) {
    const auto pos = id.find("_r");
    if (pos == std::string::npos) return id;
    const auto suffix = id.substr(pos + 2);
    require(suffix.size() == 1 && suffix >= "2" && suffix <= "9");
    return id.substr(0, pos);
}
const rules::OfferSpec* find_offer_spec(const std::string& id) {
    const auto base = offer_base(id);
    for (const auto& item : rules::offers) if (base == item.id) return &item;
    return nullptr;
}
const rules::OfferSpec& offer_catalog_item(const std::string& id) {
    const auto* spec = find_offer_spec(id);
    require(spec != nullptr);
    return *spec;
}
const rules::Policy& policy_of(const std::string& id) {
    for (const auto& item : rules::policies) if (id == item.id) return item;
    invalid();
}
const rules::ScaleRule& scale_of(const std::string& id) {
    for (const auto& item : rules::scales) if (id == item.scale) return item;
    invalid();
}
int role_index(const std::string& role) {
    for (std::size_t i = 0; i < rules::roles.size(); ++i) if (role == rules::roles[i]) return static_cast<int>(i);
    invalid();
}
const char* role_for_ability(int ability) {
    for (std::size_t i = 0; i < rules::roles.size(); ++i) if (rules::role_ability[i] == ability) return rules::roles[i];
    invalid();
}
const char* specialty_of(const Json& person) {
    const auto id = person.at("id").get<std::string>();
    for (const auto& spec : rules::staff) if (id == spec.id) return spec.specialty;
    return rules::abilities[rules::role_ability[role_index(person.at("role").get<std::string>())]];
}

Json zero_costs() {
    return {{"salary", 0}, {"operations", 0}, {"production", 0}, {"temporary", 0}, {"outsourcing", 0}, {"events", 0}, {"extension", 0}, {"penalty", 0}};
}
Json empty_finance(std::int64_t contract_received = 0) {
    return {{"contract_received", contract_received}, {"investment_paid", 0}, {"commercial_share_received", 0}, {"costs", zero_costs()}};
}
void check_costs(const Json& costs) {
    for (auto key : {"salary", "operations", "production", "temporary", "outsourcing", "events", "extension", "penalty"}) number(costs.at(key));
}
void check_finance(const Json& finance) {
    number(finance.at("contract_received")); number(finance.at("investment_paid")); number(finance.at("commercial_share_received"));
    check_costs(finance.at("costs"));
}
Integer costs_total(const Json& costs) {
    Integer total = 0;
    for (auto key : {"salary", "operations", "production", "temporary", "outsourcing", "events", "extension", "penalty"}) total += number(costs.at(key));
    return total;
}
void add_cost(Json& finance, const char* category, Integer amount) {
    if (amount <= 0) return;
    finance["costs"][category] = add(number(finance.at("costs").at(category)), amount);
}

Json make_staff(const rules::StaffSpec& spec) {
    Json abilities = Json::object(), potential = Json::object(), revealed = Json::object(), experience = Json::object();
    for (std::size_t i = 0; i < rules::abilities.size(); ++i) {
        abilities[rules::abilities[i]] = spec.abilities[i];
        potential[rules::abilities[i]] = spec.potential[i];
        revealed[rules::abilities[i]] = false;
        experience[rules::abilities[i]] = 0;
    }
    return {
        {"id", spec.id}, {"name", spec.name}, {"role", spec.role}, {"employment", "core"},
        {"abilities", abilities}, {"experience", experience}, {"potential", potential}, {"revealed_potential", revealed},
        {"talent_type", spec.talent_type}, {"clues", Json::array({spec.clue})}, {"traits", Json::array()},
        {"weekly_salary", spec.weekly_salary}, {"project_fee", 0}, {"fatigue", rules::initial_fatigue},
        {"morale", rules::initial_morale}, {"departure_warning", false}
    };
}
Json make_offer(const rules::OfferSpec& spec) {
    Json workloads = Json::object();
    for (std::size_t i = 0; i < rules::stages.size(); ++i) workloads[rules::stages[i]] = spec.workloads[i];
    return {
        {"id", spec.id}, {"name", spec.name}, {"source", spec.source}, {"scale", spec.scale},
        {"total_investment", spec.total_investment}, {"contract_budget", rules::contract_budget(spec.total_investment)},
        {"duration_weeks", spec.duration_weeks}, {"target_quality", spec.target_quality},
        {"audience_base", spec.audience_base}, {"commercial_potential", spec.commercial_potential},
        {"risk", spec.risk}, {"allowed_modes", Json::array({"contract"})}, {"workloads", workloads}, {"previous_work_id", nullptr}
    };
}
Json make_offer_variant(const rules::OfferSpec& spec, int round) {
    auto item = make_offer(spec);
    item["id"] = std::string(spec.id) + "_r" + std::to_string(round);
    item["name"] = item["name"].get<std::string>() + u8"·再演" + std::to_string(round - 1);
    return item;
}
void check_offer(const Json& item) {
    const auto id = text(item.at("id"));
    const auto& spec = offer_catalog_item(id);
    const auto name = text(item.at("name"));
    require(name == spec.name || (id != std::string(spec.id) && name.rfind(spec.name, 0) == 0));
    require(item.at("source") == Json(spec.source) && item.at("scale") == Json(spec.scale));
    require(num(item, "total_investment") == spec.total_investment);
    require(num(item, "contract_budget") == rules::contract_budget(spec.total_investment));
    require(num(item, "duration_weeks") == spec.duration_weeks && num(item, "target_quality") == spec.target_quality);
    require(num(item, "audience_base") == spec.audience_base && num(item, "commercial_potential") == spec.commercial_potential);
    require(item.at("risk") == Json(spec.risk));
    for (std::size_t i = 0; i < rules::stages.size(); ++i) require(num(item.at("workloads"), rules::stages[i]) == spec.workloads[i]);
    require(item.at("allowed_modes").is_array() && item.at("allowed_modes").size() == 1 && item.at("allowed_modes")[0] == "contract");
    require(item.at("previous_work_id").is_null());
}

Integer salary_total(const Json& state) {
    Integer total = rules::operations_weekly;
    for (const auto& person : state.at("company").at("staff")) total += num(person, "weekly_salary");
    return total;
}
Json recommended_configuration(const Json& state, const std::string& stage) {
    const auto required = std::string(rules::abilities[rules::stage_ability[stage_index(stage)]]);
    Json assignments = Json::array();
    for (const auto& person : state.at("company").at("staff")) assignments.push_back({{"staff_id", person.at("id")}, {"role", person.at("role")}, {"focus", required}});
    for (const auto& person : state.at("project").at("temporary_staff")) assignments.push_back({{"staff_id", person.at("id")}, {"role", person.at("role")}, {"focus", required}});
    return {{"assignments", assignments}, {"policy", "balanced"}, {"overtime", false}};
}
bool is_producing_active(const Json& state) {
    const auto& project = state.at("project");
    return project.is_object() && !project.at("current_stage").is_null()
        && project.at("stages").at(project.at("current_stage").get<std::string>()).at("status") == "active";
}
Json idle_preview(const Json& state) {
    const auto total = salary_total(state);
    auto costs = zero_costs();
    costs["salary"] = total - rules::operations_weekly;
    costs["operations"] = rules::operations_weekly;
    return {{"next_week", num(state.at("company"), "week") + 1}, {"costs", costs}, {"total_cost", total}, {"event_probability_per_mille", 0}};
}
Integer weekly_production_cost(const Json& state) {
    const auto& project = state.at("project");
    const auto& stage = project.at("stages").at(project.at("current_stage").get<std::string>());
    const auto& config = stage.at("configuration");
    const auto& policy = policy_of(config.at("policy").get<std::string>());
    const auto workers = static_cast<Integer>(config.at("assignments").size());
    return rules::stage_cost * policy.cost / 1000 + (config.at("overtime") == true ? rules::overtime_cost * workers : 0);
}
Json active_preview(const Json& state) {
    const auto salaries = salary_total(state) - rules::operations_weekly;
    const auto production = weekly_production_cost(state);
    auto costs = zero_costs();
    costs["salary"] = salaries; costs["operations"] = rules::operations_weekly; costs["production"] = production;
    return {{"next_week", num(state.at("company"), "week") + 1}, {"costs", costs}, {"total_cost", salaries + rules::operations_weekly + production}, {"event_probability_per_mille", 0}};
}
void refresh_preview(Json& state) {
    const auto& phase = state.at("phase");
    if (state.at("company").at("status") != "running") state["preview"] = nullptr;
    else if (phase == "idle") state["preview"] = idle_preview(state);
    else if (phase == "producing" && is_producing_active(state)) state["preview"] = active_preview(state);
    else state["preview"] = nullptr;
}
Json generate_offers(const Json& state) {
    const auto seed = static_cast<std::uint32_t>(number(state.at("seed"), rules::max_seed));
    std::set<std::string> used;
    for (const auto& work : state.at("history")) used.insert(work.at("id").get<std::string>());
    Json result = Json::array();
    const auto start = seed % rules::offers.size();
    for (std::size_t offset = 0; offset < rules::offers.size() && result.size() < 4; ++offset) {
        const auto& spec = rules::offers[(start + offset) % rules::offers.size()];
        if (!used.count(spec.id)) { result.push_back(make_offer(spec)); continue; }
        for (int round = 2; round <= 9 && result.size() < 4; ++round) {
            if (used.count(std::string(spec.id) + "_r" + std::to_string(round))) continue;
            result.push_back(make_offer_variant(spec, round));
            break;
        }
    }
    require(result.size() == 4);
    return result;
}
// 招募池生成：每次成功 scout 恰消耗 48 步 LCG（3 候选×16 步），失败 0 步。
// 顺序：档→模板→六能力→六潜力→姓→名；形状修正/带修正/重名回绕不消耗种子。
Json generate_pool(const Json& state, const Json& decision, std::uint32_t& seed_out, Json& pity_out) {
    const bool targeted = decision.at("type") == "targeted_scout";
    int focus = -1;
    std::string fixed_role;
    if (targeted) {
        const bool has_role = decision.contains("role");
        const bool has_focus = decision.contains("focus_ability");
        require(has_role != has_focus);
        if (has_role) {
            fixed_role = text(decision.at("role"));
            focus = rules::role_ability[role_index(fixed_role)];
        } else {
            const auto name = text(decision.at("focus_ability"));
            for (std::size_t i = 0; i < rules::abilities.size(); ++i) if (name == rules::abilities[i]) focus = static_cast<int>(i);
            require(focus >= 0);
        }
    }
    auto seed = static_cast<std::uint32_t>(number(state.at("seed"), rules::max_seed));
    auto draw = [&](std::uint32_t mod) { seed = next_seed(seed); return static_cast<int>(seed % mod); };
    const auto shift = static_cast<int>(std::min<Integer>(num(state.at("company"), "reputation") / rules::reputation_shift_step, 10)) * rules::reputation_shift_permille;
    auto chance = rules::band_chance;
    chance[0] -= 2 * shift; chance[2] += shift; chance[3] += shift;
    require(chance[0] >= 100);
    const auto pity = state.at("company").contains("scout_pity") ? state.at("company").at("scout_pity") : Json{{"since_sr", 0}, {"since_ssr", 0}};
    const auto since_sr = num(pity, "since_sr");
    const auto since_ssr = num(pity, "since_ssr");
    std::set<std::string> names;
    for (const auto& person : state.at("company").at("staff")) names.insert(person.at("name").get<std::string>());
    for (const auto& person : state.at("recruitment_pool")) names.insert(person.at("name").get<std::string>());
    Json pool = Json::array();
    int best_band = 0;
    for (int c = 0; c < rules::scout_candidates; ++c) {
        const auto roll = draw(1000);
        int band = 0, cumulative = 0;
        for (std::size_t i = 0; i < chance.size(); ++i) { cumulative += chance[i]; if (roll < cumulative) { band = static_cast<int>(i); break; } }
        if (c == rules::scout_candidates - 1) {
            if (since_ssr + 1 >= rules::pity_ssr) band = 3;
            else if (since_sr + 1 >= rules::pity_sr && band < 2) band = 2;
        }
        std::vector<int> compat;
        for (std::size_t i = 0; i < rules::templates.size(); ++i) if (rules::templates[i].bands & (1 << band)) compat.push_back(static_cast<int>(i));
        const auto& tpl = rules::templates[compat[draw(static_cast<std::uint32_t>(compat.size()))]];
        const auto range = rules::band_range[band];
        std::array<int, 6> ability{};
        for (std::size_t i = 0; i < ability.size(); ++i) ability[i] = range.lo + draw(static_cast<std::uint32_t>(range.hi - range.lo + 1));
        int spike = tpl.spike;
        if (spike == -2) spike = static_cast<int>(std::max_element(ability.begin(), ability.end()) - ability.begin());
        if (spike >= 0) ability[spike] = std::min(100, ability[spike] + tpl.boost);
        if (tpl.penalty > 0) for (std::size_t i = 0; i < ability.size(); ++i) if (static_cast<int>(i) != spike) ability[i] = std::max(0, ability[i] - tpl.penalty);
        if (targeted) ability[focus] = std::min(100, ability[focus] + 15);
        int sum = 0;
        for (auto value : ability) sum += value;
        while (sum < range.lo) {
            const auto it = std::max_element(ability.begin(), ability.end());
            if (*it >= 100) break;
            ++*it; ++sum;
        }
        while (sum > range.hi) {
            const auto it = std::min_element(ability.begin(), ability.end());
            if (*it <= 0) break;
            --*it; --sum;
        }
        const auto role = targeted && !fixed_role.empty() ? fixed_role : std::string(role_for_ability(spike >= 0 ? spike : static_cast<int>(std::max_element(ability.begin(), ability.end()) - ability.begin())));
        Json abilities = Json::object(), potential = Json::object(), revealed = Json::object(), experience = Json::object();
        for (std::size_t i = 0; i < ability.size(); ++i) {
            abilities[rules::abilities[i]] = ability[i];
            potential[rules::abilities[i]] = std::min(100, ability[i] + tpl.potential_lo + draw(static_cast<std::uint32_t>(tpl.potential_hi - tpl.potential_lo + 1)));
            revealed[rules::abilities[i]] = false;
            experience[rules::abilities[i]] = 0;
        }
        auto surname = draw(static_cast<std::uint32_t>(rules::surnames.size()));
        const auto given = draw(static_cast<std::uint32_t>(rules::given_names.size()));
        std::string name = std::string(rules::surnames[surname]) + rules::given_names[given];
        while (names.count(name)) {
            surname = (surname + 1) % static_cast<int>(rules::surnames.size());
            name = std::string(rules::surnames[surname]) + rules::given_names[given];
        }
        names.insert(name);
        const auto salary = (rules::salary_base + sum * rules::salary_per_point) * tpl.salary_permille / 1000;
        pool.push_back({
            {"id", "cand_" + std::to_string(seed)}, {"name", name}, {"role", role}, {"employment", "core"},
            {"abilities", abilities}, {"experience", experience}, {"potential", potential}, {"revealed_potential", revealed},
            {"talent_type", tpl.talent}, {"clues", Json::array({tpl.clue1, tpl.clue2})}, {"traits", Json::array()},
            {"weekly_salary", salary}, {"project_fee", 0}, {"fatigue", rules::initial_fatigue},
            {"morale", rules::initial_morale}, {"departure_warning", false}
        });
        best_band = std::max(best_band, band);
    }
    seed_out = seed;
    pity_out = {{"since_sr", best_band >= 2 ? 0 : since_sr + 1}, {"since_ssr", best_band >= 3 ? 0 : since_ssr + 1}};
    return pool;
}
Json team_snapshot(const Json& person) {
    return {{"staff_id", person.at("id")}, {"name", person.at("name")}, {"role", person.at("role")}, {"employment", person.at("employment")}, {"abilities", person.at("abilities")}};
}
Json build_summary(const Json& state) {
    const auto& company = state.at("company");
    const auto funds = number(company.at("funds"), rules::max_integer, -rules::max_integer);
    std::string best;
    Integer best_quality = -1;
    for (const auto& work : state.at("history")) {
        const auto quality = num(work, "quality_score");
        if (quality > best_quality) { best_quality = quality; best = work.at("id").get<std::string>(); }
    }
    const auto rating = funds >= rules::rating_renowned ? "renowned" : funds >= rules::rating_stable ? "stable" : funds >= rules::rating_small ? "small" : "failed";
    return {
        {"reason", company.at("end_reason")}, {"weeks", company.at("week")}, {"final_funds", funds},
        {"net_cash_change", sub(funds, num(company, "initial_funds"))}, {"total_projects", state.at("history").size()},
        {"best_work_id", best.empty() ? Json(nullptr) : Json(best)}, {"rating", rating}
    };
}

// ---------- 完整状态校验 ----------
void check_staff_generated(const Json& person) {
    const auto id = text(person.at("id"));
    require(id.rfind("cand_", 0) == 0 && id.size() > 5);
    require(!text(person.at("name")).empty());
    role_index(text(person.at("role")));
    require(person.at("employment") == "core");
    int sum = 0;
    for (auto ability : rules::abilities) {
        const auto value = number(person.at("abilities").at(ability), 100);
        const auto potential = number(person.at("potential").at(ability), 100);
        require(potential >= value);
        require(person.at("revealed_potential").at(ability).is_boolean());
        number(person.at("experience").at(ability));
        sum += static_cast<int>(value);
    }
    require(one_of(person.at("talent_type"), {"specialist", "uneven", "generalist", "ordinary"}));
    require(person.at("clues").is_array() && person.at("clues").size() >= 1 && person.at("clues").size() <= 2);
    for (const auto& clue : person.at("clues")) {
        const auto value = text(clue);
        bool found = false;
        for (const auto& tpl : rules::templates) if (value == tpl.clue1 || value == tpl.clue2) found = true;
        require(found);
    }
    require(person.at("traits").is_array());
    require(num(person, "weekly_salary") >= rules::salary_base + sum * rules::salary_per_point);
    require(num(person, "project_fee") == 0);
    number(person.at("morale"), 100); number(person.at("fatigue"), 100);
    require(person.at("departure_warning").is_boolean());
}
void check_staff(const Json& person) {
    const auto id = text(person.at("id"));
    const auto& spec = staff_spec(id);
    require(person.at("name") == Json(spec.name) && person.at("role") == Json(spec.role) && person.at("employment") == "core");
    require(person.at("talent_type") == Json(spec.talent_type));
    for (std::size_t i = 0; i < rules::abilities.size(); ++i) {
        const auto ability = rules::abilities[i];
        require(number(person.at("abilities").at(ability), 100) == spec.abilities[i]);
        require(number(person.at("potential").at(ability), 100) == spec.potential[i]);
        require(person.at("revealed_potential").at(ability).is_boolean());
        number(person.at("experience").at(ability));
    }
    require(person.at("clues").is_array() && person.at("clues").size() == 1 && person.at("clues")[0] == Json(spec.clue));
    require(person.at("traits").is_array());
    require(num(person, "weekly_salary") >= spec.weekly_salary && num(person, "project_fee") == 0);
    number(person.at("morale"), 100); number(person.at("fatigue"), 100);
    require(person.at("departure_warning").is_boolean());
}
void check_configuration(const Json& config, const Json& state, bool references_current) {
    require(config.is_object() && one_of(config.at("policy"), {"quality", "balanced", "deadline"}) && config.at("overtime").is_boolean());
    require(config.at("assignments").is_array());
    std::set<std::string> seen;
    for (const auto& item : config.at("assignments")) {
        const auto id = text(item.at("staff_id"));
        require(seen.insert(id).second);
        bool focus_ok = false;
        for (auto ability : rules::abilities) if (item.at("focus") == Json(ability)) focus_ok = true;
        require(focus_ok);
        if (references_current) {
            bool found = false;
            for (const auto& person : state.at("company").at("staff")) if (person.at("id") == id) { require(item.at("role") == person.at("role")); found = true; }
            require(found);
        } else text(item.at("role"));
    }
}
void check_stage_result(const Json& result) {
    require(result.is_object());
    number(result.at("weeks_spent"), rules::max_weeks, 1);
    number(result.at("quality"), 100);
    check_costs(result.at("costs"));
    require(result.at("issues").is_array());
    require(result.at("team").is_array() && !result.at("team").empty());
    std::set<std::string> ids;
    for (const auto& member : result.at("team")) {
        require(ids.insert(text(member.at("staff_id"))).second);
        require(one_of(member.at("employment"), {"core", "temporary"}));
        for (auto ability : rules::abilities) number(member.at("abilities").at(ability), 100);
    }
}
void check_project(const Json& project, const Json& state) {
    require(project.is_object() && project.at("mode") == "contract" && num(project, "investment_percent") == 0);
    check_offer(project.at("offer"));
    const auto& spec = offer_catalog_item(project.at("offer").at("id").get<std::string>());
    number(project.at("opening_funds"));
    const auto week = num(state.at("company"), "week");
    const auto start = number(project.at("start_week"), rules::max_weeks);
    const auto deadline = number(project.at("deadline_week"), rules::max_integer, start + 1);
    require(start <= week);
    require(num(project, "extension_count") == 0 && project.at("committee_pressure").is_null());
    check_finance(project.at("finance"));
    require(num(project.at("finance"), "investment_paid") == 0 && num(project.at("finance"), "commercial_share_received") == 0 && num(project.at("finance").at("costs"), "events") == 0);
    require(project.at("temporary_staff").is_array() && project.at("temporary_staff").empty());
    require(project.at("outsourcing").is_array() && project.at("outsourcing").empty());
    const auto& delivery = project.at("delivery_reason");
    require(delivery.is_null() || one_of(delivery, {"completed", "deadline", "company_closed"}));
    int current = -1;
    if (!project.at("current_stage").is_null()) current = stage_index(text(project.at("current_stage")));
    const auto all_done = current == -1;
    for (std::size_t i = 0; i < rules::stages.size(); ++i) {
        const auto& stage = project.at("stages").at(rules::stages[i]);
        const auto& status = stage.at("status");
        require(one_of(status, {"pending", "ready", "active", "completed"}));
        require(number(stage.at("work_done"), spec.workloads[i]) >= 0);
        number(stage.at("quality"), 100);
        if (status == "pending") {
            require(stage.at("configuration").is_null() && stage.at("result").is_null() && stage.at("recommended_configuration").is_null() && num(stage, "work_done") == 0 && static_cast<int>(i) > current);
        } else if (status == "ready") {
            require(stage.at("configuration").is_null() && stage.at("result").is_null() && num(stage, "work_done") == 0 && static_cast<int>(i) == current);
            if (!stage.at("recommended_configuration").is_null()) check_configuration(stage.at("recommended_configuration"), state, true);
        } else if (status == "active") {
            require(!stage.at("configuration").is_null() && stage.at("result").is_null() && static_cast<int>(i) == current && num(stage, "work_done") < spec.workloads[i]);
            check_configuration(stage.at("configuration"), state, true);
        } else {
            require(!stage.at("configuration").is_null() && !stage.at("result").is_null() && num(stage, "work_done") == spec.workloads[i] && (static_cast<int>(i) < current || all_done));
            check_configuration(stage.at("configuration"), state, false);
            check_stage_result(stage.at("result"));
        }
    }
    if (state.at("phase") == "producing") {
        require(delivery.is_null() && !all_done && week < deadline);
    } else {
        require(!delivery.is_null());
        if (delivery == "completed") require(all_done);
        if (delivery == "deadline") require(!all_done && week >= deadline);
        if (delivery == "company_closed") require(state.at("company").at("status") != "running" && !all_done);
    }
}
void check_work_record(const Json& work, const Json& state, std::set<std::string>& history_ids) {
    const auto id = text(work.at("id"));
    require(history_ids.insert(id).second);
    const auto& spec = offer_catalog_item(id);
    require(text(work.at("name")).rfind(spec.name, 0) == 0);
    require(work.at("source") == Json(spec.source) && work.at("scale") == Json(spec.scale));
    const auto start = number(work.at("start_week"), rules::max_weeks);
    number(work.at("end_week"), rules::max_weeks, start);
    require(number(work.at("end_week"), rules::max_weeks) <= num(state.at("company"), "week"));
    require(work.at("previous_work_id").is_null());
    require(one_of(work.at("end_reason"), {"completed", "deadline", "company_closed"}));
    require(work.at("mode") == "contract" && num(work, "investment_percent") == 0);
    number(work.at("quality_score"), 100); number(work.at("commercial_score"), 100);
    number(work.at("commercial_revenue"));
    check_finance(work.at("finance"));
    require(num(work.at("finance"), "investment_paid") == 0 && num(work.at("finance"), "commercial_share_received") == 0);
    signed_number(work.at("profit"));
    require(work.at("team").is_array());
    for (const auto& member : work.at("team")) require(one_of(member.at("employment"), {"core", "temporary"}));
    for (std::size_t i = 0; i < rules::stages.size(); ++i) {
        const auto& stage = work.at("stages").at(rules::stages[i]);
        require(one_of(stage.at("status"), {"pending", "ready", "active", "completed"}));
        require(number(stage.at("work_done"), spec.workloads[i]) >= 0);
        number(stage.at("quality"), 100);
        if (stage.at("status") == "completed") check_stage_result(stage.at("result"));
    }
}
void validate(const Json& state) {
    require(state.is_object() && num(state, "version") == rules::version);
    number(state.at("seed"), rules::max_seed);
    const auto& phase = state.at("phase");
    require(one_of(phase, {"idle", "producing", "event_pending", "project_ready", "project_settled", "company_ended"}));
    const auto& company = state.at("company");
    const auto week = number(company.at("week"), rules::max_weeks);
    const auto& status = company.at("status");
    require(one_of(status, {"running", "closing", "ended"}));
    number(company.at("initial_funds"));
    signed_number(company.at("funds"));
    number(company.at("reputation"));
    check_finance(company.at("finance"));
    if (status == "running") {
        require(company.at("end_reason").is_null() && num(company, "funds") >= 0 && week < rules::max_weeks);
    } else {
        require(one_of(company.at("end_reason"), {"time_limit", "bankrupt", "voluntary"}));
        require(signed_number(company.at("funds")) >= 0 || company.at("end_reason") == "bankrupt");
        if (company.at("end_reason") == "time_limit") require(week == rules::max_weeks);
    }
    require(company.at("staff").is_array() && company.at("staff").size() >= rules::staff.size()
        && company.at("staff").size() <= static_cast<std::size_t>(rules::core_staff_cap));
    std::set<std::string> roster_ids, roster_names;
    for (const auto& person : company.at("staff")) {
        const auto id = person.at("id").get<std::string>();
        require(roster_ids.insert(id).second);
        require(roster_names.insert(person.at("name").get<std::string>()).second);
        bool fixed = false;
        for (const auto& spec : rules::staff) if (id == spec.id) fixed = true;
        if (fixed) check_staff(person); else check_staff_generated(person);
    }
    if (company.contains("scout_pity")) {
        const auto& pity = company.at("scout_pity");
        number(pity.at("since_sr"), rules::pity_sr - 1);
        number(pity.at("since_ssr"), rules::pity_ssr - 1);
    }
    require(state.at("pending_event").is_null());
    require(state.at("suppliers").is_array() && state.at("suppliers").empty());
    require(state.at("recruitment_pool").is_array() && state.at("recruitment_pool").size() <= static_cast<std::size_t>(rules::scout_candidates));
    std::set<std::string> pool_ids;
    for (const auto& person : state.at("recruitment_pool")) {
        const auto id = person.at("id").get<std::string>();
        require(pool_ids.insert(id).second && roster_ids.count(id) == 0);
        require(roster_names.insert(person.at("name").get<std::string>()).second);
        check_staff_generated(person);
    }
    const auto& project = state.at("project");
    const auto& offers = state.at("offers");
    require(offers.is_array() && offers.size() <= 4);
    std::set<std::string> offer_ids;
    for (const auto& item : offers) { require(offer_ids.insert(item.at("id").get<std::string>()).second); check_offer(item); }
    require(state.at("history").is_array());
    std::set<std::string> history_ids;
    for (const auto& work : state.at("history")) check_work_record(work, state, history_ids);
    const auto& last = state.at("last_project_id");
    require(last.is_null() || (last.is_string() && history_ids.count(last.get<std::string>()) > 0));
    if (status == "ended") {
        require(phase == "company_ended" && !state.at("company_result").is_null() && state.at("company_result") == build_summary(state));
    } else {
        require(phase != "company_ended" && state.at("company_result").is_null());
    }
    if (status == "closing") require(phase != "producing" && phase != "event_pending");
    if (status == "running") require(phase != "company_ended");
    const auto& preview = state.at("preview");
    if (status == "running" && (phase == "idle" || (phase == "producing" && is_producing_active(state)))) {
        const auto expected = phase == "idle" ? idle_preview(state) : active_preview(state);
        require(preview == expected);
    } else require(preview.is_null());
    if (phase == "idle") {
        require(project.is_null() && last.is_null());
        require(offers.size() == (status == "running" ? 4 : 0));
    } else if (phase == "producing") {
        require(offers.empty());
        check_project(project, state);
    } else if (phase == "project_ready") {
        require(offers.empty());
        check_project(project, state);
    } else if (phase == "project_settled") {
        require(project.is_null() && !last.is_null() && offers.empty());
    } else if (phase == "company_ended") {
        require(project.is_null() && offers.empty());
    } else invalid();
}
void running_check(const Json& state) {
    if (state.at("company").at("status") != "running") ended_company();
}
void pay_weekly_costs(Json& state, Integer salaries, Integer production_or_none) {
    state["company"]["finance"]["costs"]["salary"] = add(num(state.at("company").at("finance").at("costs"), "salary"), salaries);
    state["company"]["finance"]["costs"]["operations"] = add(num(state.at("company").at("finance").at("costs"), "operations"), rules::operations_weekly);
    if (production_or_none > 0) add_cost(state["company"]["finance"], "production", production_or_none);
    if (state.at("project").is_object()) {
        state["project"]["finance"]["costs"]["salary"] = add(num(state.at("project").at("finance").at("costs"), "salary"), salaries);
        state["project"]["finance"]["costs"]["operations"] = add(num(state.at("project").at("finance").at("costs"), "operations"), rules::operations_weekly);
        if (production_or_none > 0) add_cost(state["project"]["finance"], "production", production_or_none);
    }
}
Json zero_report(const Json& state) {
    return {{"week", num(state.at("company"), "week")}, {"funds_delta", 0}, {"costs", zero_costs()}, {"stage_deltas", Json::array()}, {"staff_deltas", Json::array()}, {"messages", Json::array()}};
}
void close_bankrupt(Json& state) {
    state["company"]["status"] = "closing";
    state["company"]["end_reason"] = "bankrupt";
    state["preview"] = nullptr;
    if (state.at("phase") == "producing") {
        state["project"]["delivery_reason"] = "company_closed";
        state["phase"] = "project_ready";
    } else state["offers"] = Json::array();
}
Json complete_stage(Json& state, const std::string& stage, int index) {
    auto& project = state["project"];
    auto& item = project["stages"][stage];
    const auto& config = item.at("configuration");
    const auto& policy = policy_of(config.at("policy").get<std::string>());
    Integer earlier = 0;
    for (int i = 0; i < index; ++i) earlier += num(project.at("stages").at(rules::stages[i]).at("result"), "weeks_spent");
    const auto elapsed = num(state.at("company"), "week") - num(project, "start_week");
    const auto weeks_spent = std::max<Integer>(1, elapsed - earlier);
    const auto workers = static_cast<Integer>(config.at("assignments").size());
    auto costs = zero_costs();
    costs["production"] = weeks_spent * (rules::stage_cost * policy.cost / 1000) + (config.at("overtime") == true ? weeks_spent * rules::overtime_cost * workers : 0);
    const auto quality = num(item, "quality");
    Json issues = Json::array();
    if (quality < 40) issues.push_back(u8"画面稳定性不足，需要后续作品改进");
    else if (quality < 60) issues.push_back(u8"演出完成度低于预期");
    Json team = Json::array();
    std::set<std::string> seen;
    for (const auto& assignment : config.at("assignments")) {
        const auto id = assignment.at("staff_id").get<std::string>();
        if (!seen.insert(id).second) continue;
        for (const auto& person : state.at("company").at("staff")) if (person.at("id") == id) team.push_back(team_snapshot(person));
    }
    item["result"] = {{"weeks_spent", weeks_spent}, {"quality", quality}, {"costs", costs}, {"issues", issues}, {"team", team}};
    item["status"] = "completed";
    return item["result"];
}

template<class Action> std::string execute(const std::string& input, Action action, bool with_state = true) {
    try {
        auto request = Json::parse(input);
        require(request.is_object());
        if (with_state) validate(request.at("state"));
        return action(request).dump();
    } catch (const ApiError& error) {
        return Json{{"error", {{"code", error.code}, {"message", error.message}}}}.dump();
    } catch (const Json::exception&) {
        return Json{{"error", {{"code", "INVALID_INPUT"}, {"message", u8"JSON、字段类型或数值范围无效。"}}}}.dump();
    } catch (...) {
        return R"({"error":{"code":"INTERNAL_ERROR","message":"An internal error occurred."}})";
    }
}
Json response(Json state, const std::string& message) { return {{"state", std::move(state)}, {"message", message}}; }
}

std::string initialize_game(std::string input) {
    return execute(input, [](const Json& request) {
        const auto seed = number(request.at("seed"), rules::max_seed);
        Json staff = Json::array();
        for (const auto& spec : rules::staff) staff.push_back(make_staff(spec));
        Json offers = Json::array();
        for (std::size_t i = 0; i < 4; ++i) offers.push_back(make_offer(rules::offers[i]));
        Json state = {
            {"version", rules::version}, {"seed", static_cast<Integer>(seed)}, {"phase", "idle"},
            {"company", {
                {"week", 0}, {"status", "running"}, {"end_reason", nullptr},
                {"initial_funds", rules::initial_funds}, {"funds", rules::initial_funds},
                {"reputation", rules::initial_reputation}, {"staff", staff}, {"finance", empty_finance()},
                {"scout_pity", {{"since_sr", 0}, {"since_ssr", 0}}}
            }},
            {"offers", offers}, {"recruitment_pool", Json::array()}, {"suppliers", Json::array()},
            {"project", nullptr}, {"pending_event", nullptr}, {"history", Json::array()},
            {"last_project_id", nullptr}, {"company_result", nullptr}, {"preview", nullptr}
        };
        refresh_preview(state);
        return response(std::move(state), u8"新公司成立，等待接手企划。空闲周仍需支付工资与日常运营开支。");
    }, false);
}

std::string start_project(std::string input) {
    return execute(input, [](const Json& request) {
        auto state = request.at("state");
        running_check(state);
        if (state.at("phase") != "idle") wrong_phase();
        const auto id = text(request.at("offer_id"));
        const auto mode = text(request.at("mode"));
        if (mode == "committee") not_allowed(u8"委员会投资与商业分成规则将在后续里程碑实现，当前仅开放承制路线。");
        if (mode != "contract") invalid();
        require(num(request, "investment_percent") == 0);
        const Json* offer_json = nullptr;
        for (const auto& item : state.at("offers")) if (item.at("id") == id) offer_json = &item;
        require(offer_json != nullptr);
        const auto& spec = offer_catalog_item(id);
        const auto grant = num(*offer_json, "contract_budget");
        Json stages = Json::object();
        for (std::size_t i = 0; i < rules::stages.size(); ++i) {
            stages[rules::stages[i]] = {
                {"status", i == 0 ? "ready" : "pending"}, {"work_done", 0}, {"quality", 0},
                {"configuration", nullptr}, {"recommended_configuration", nullptr}, {"result", nullptr}
            };
        }
        state["project"] = {
            {"offer", *offer_json}, {"mode", "contract"}, {"investment_percent", 0},
            {"opening_funds", num(state.at("company"), "funds")}, {"start_week", num(state.at("company"), "week")},
            {"deadline_week", add(num(state.at("company"), "week"), static_cast<Integer>(spec.duration_weeks))},
            {"current_stage", std::string(rules::stages[0])}, {"stages", stages},
            {"extension_count", 0}, {"committee_pressure", nullptr}, {"finance", empty_finance(grant)},
            {"temporary_staff", Json::array()}, {"outsourcing", Json::array()}, {"delivery_reason", nullptr}
        };
        state["company"]["funds"] = add(num(state.at("company").at("funds")), grant);
        state["company"]["finance"]["contract_received"] = add(num(state.at("company").at("finance"), "contract_received"), grant);
        state["offers"] = Json::array();
        state["phase"] = "producing";
        state["project"]["stages"]["script"]["recommended_configuration"] = recommended_configuration(state, "script");
        refresh_preview(state);
        return response(std::move(state), u8"企划已接手，合同预算 " + std::to_string(grant) + u8" 日元一次性到账；投资差额由出品方承担。请完成「脚本」阶段配置后再推进。");
    });
}

std::string apply_decision(std::string input) {
    return execute(input, [](const Json& request) {
        auto state = request.at("state");
        const auto& decision = request.at("decision");
        const auto type = text(decision.at("type"));
        const auto& phase = state.at("phase");
        if (type == "end_company") {
            running_check(state);
            state["company"]["status"] = "closing";
            state["company"]["end_reason"] = "voluntary";
            state["preview"] = nullptr;
            state["offers"] = Json::array();
            if (phase == "producing") {
                state["project"]["delivery_reason"] = "company_closed";
                state["phase"] = "project_ready";
                return response(std::move(state), u8"公司主动结束。在制项目已转入待交付结算，请完成结算后生成经营总结。");
            }
            return response(std::move(state), u8"公司主动结束，进入经营总结；周数未推进，薪资未扣款。");
        }
        running_check(state);
        if (type == "configure_stage") {
            if (phase != "producing") wrong_phase();
            const auto stage = text(decision.at("stage"));
            if (stage != state.at("project").at("current_stage").get<std::string>()) invalid();
            auto& item = state["project"]["stages"][stage];
            if (item.at("status") == "active") locked();
            require(item.at("status") == "ready");
            check_configuration(decision.at("configuration"), state, true);
            item["configuration"] = decision.at("configuration");
            item["status"] = "active";
            refresh_preview(state);
            return response(std::move(state), u8"阶段方案已锁定，阶段进行期间不可修改；推进前不扣款。");
        }
        if (type == "hire_temporary" || type == "outsource") {
            if (phase != "producing") wrong_phase();
            invalid();
        }
        if (type == "scout" || type == "targeted_scout") {
            if (phase != "idle" && phase != "project_settled") wrong_phase();
            const auto fee = type == "scout" ? rules::scout_fee : rules::targeted_scout_fee;
            if (num(state.at("company"), "funds") < fee) insufficient();
            std::uint32_t new_seed = 0;
            Json pity;
            auto pool = generate_pool(state, decision, new_seed, pity);
            state["company"]["funds"] = sub(num(state.at("company"), "funds"), fee);
            add_cost(state["company"]["finance"], "operations", fee);
            state["company"]["scout_pity"] = pity;
            state["seed"] = static_cast<Integer>(new_seed);
            state["recruitment_pool"] = pool;
            refresh_preview(state);
            return response(std::move(state), u8"招募完成，支付 " + std::to_string(fee) + u8" 日元（记运营）；候选池已刷新为 " + std::to_string(pool.size()) + u8" 人，录用前请核对能力与周薪。");
        }
        if (type == "hire_core") {
            if (phase != "idle" && phase != "project_settled") wrong_phase();
            const auto id = text(decision.at("candidate_id"));
            const auto& pool = state.at("recruitment_pool");
            std::size_t index = pool.size();
            for (std::size_t i = 0; i < pool.size(); ++i) if (pool[i].at("id") == id) index = i;
            require(index < pool.size());
            if (state.at("company").at("staff").size() >= static_cast<std::size_t>(rules::core_staff_cap)) capacity();
            auto person = pool[index];
            state["company"]["staff"].push_back(person);
            state["recruitment_pool"].erase(index);
            refresh_preview(state);
            return response(std::move(state), u8"已录用 " + person.at("name").get<std::string>() + u8" 为核心员工，周薪 " + std::to_string(num(person, "weekly_salary")) + u8" 日元自下一次周结算起支付。");
        }
        if (type == "request_extension") {
            if (phase != "producing") wrong_phase();
            not_allowed(u8"承制路线不可延期；委员会延期规则在后续里程碑实现。");
        }
        if (type == "raise_salary") {
            if (phase != "idle" && phase != "project_settled") wrong_phase();
            const auto id = text(decision.at("staff_id"));
            std::size_t index = state.at("company").at("staff").size();
            for (std::size_t i = 0; i < state.at("company").at("staff").size(); ++i) if (state["company"]["staff"][i].at("id") == id) index = i;
            require(index < state.at("company").at("staff").size());
            const auto salary = num(decision, "weekly_salary");
            require(salary > num(state.at("company").at("staff").at(index), "weekly_salary"));
            state["company"]["staff"][index]["weekly_salary"] = salary;
            refresh_preview(state);
            return response(std::move(state), u8"薪资调整自下一次周结算起生效，本周不重复扣款。");
        }
        if (type == "return_to_market") {
            if (phase != "project_settled") wrong_phase();
            state["last_project_id"] = nullptr;
            state["seed"] = static_cast<Integer>(next_seed(static_cast<std::uint32_t>(number(state.at("seed"), rules::max_seed))));
            state["offers"] = generate_offers(state);
            state["phase"] = "idle";
            refresh_preview(state);
            return response(std::move(state), u8"已回到企划市场，本周未推进；空闲周仍需支付固定开支。");
        }
        invalid();
    });
}

std::string advance_week(std::string input) {
    return execute(input, [](const Json& request) {
        auto state = request.at("state");
        running_check(state);
        auto report = zero_report(state);
        if (state.at("phase") == "idle") {
            const auto cost = salary_total(state);
            if (num(state.at("company"), "funds") < cost) {
                close_bankrupt(state);
                report["messages"].push_back(u8"资金不足以支付本周工资与运营开支，公司破产进入结束流程；未扣款、未推进周数、企划未刷新。");
                return Json{{"state", state}, {"report", report}};
            }
            const auto salaries = cost - rules::operations_weekly;
            state["company"]["funds"] = sub(num(state.at("company").at("funds")), cost);
            pay_weekly_costs(state, salaries, 0);
            state["company"]["week"] = add(num(state.at("company").at("week")), 1);
            state["seed"] = static_cast<Integer>(next_seed(static_cast<std::uint32_t>(number(state.at("seed"), rules::max_seed))));
            state["offers"] = generate_offers(state);
            report["week"] = num(state.at("company"), "week");
            report["funds_delta"] = -cost;
            report["costs"]["salary"] = salaries;
            report["costs"]["operations"] = rules::operations_weekly;
            report["messages"].push_back(u8"空闲周结算：支付固定开支 " + std::to_string(cost) + u8" 日元，企划已刷新。");
            if (num(state.at("company"), "week") == rules::max_weeks) {
                state["company"]["status"] = "closing";
                state["company"]["end_reason"] = "time_limit";
                state["offers"] = Json::array();
                report["messages"].push_back(u8"十年经营期满，公司进入结束流程，请生成经营总结。");
            }
            refresh_preview(state);
            return Json{{"state", state}, {"report", report}};
        }
        if (state.at("phase") != "producing" || !is_producing_active(state)) wrong_phase();
        const auto stage_name = state.at("project").at("current_stage").get<std::string>();
        const auto index = stage_index(stage_name);
        const auto& config = state.at("project").at("stages").at(stage_name).at("configuration");
        const auto& policy = policy_of(config.at("policy").get<std::string>());
        const auto production = weekly_production_cost(state);
        const auto salaries = salary_total(state) - rules::operations_weekly;
        const auto cost = salaries + rules::operations_weekly + production;
        if (num(state.at("company"), "funds") < cost) {
            close_bankrupt(state);
            report["messages"].push_back(u8"资金不足以支付本周开支，公司破产进入结束流程；未扣款、未推进周数，项目转入待交付结算。");
            return Json{{"state", state}, {"report", report}};
        }
        const auto& stage_json = state.at("project").at("stages").at(stage_name);
        const auto old_work = num(stage_json, "work_done");
        const auto old_quality = num(stage_json, "quality");
        std::map<std::string, Json> staff_before;
        for (const auto& person : state.at("company").at("staff")) staff_before[person.at("id").get<std::string>()] = person;
        state["company"]["funds"] = sub(num(state.at("company").at("funds")), cost);
        pay_weekly_costs(state, salaries, production);
        const auto required = std::string(rules::abilities[rules::stage_ability[index]]);
        Integer work = 0, quality_sum = 0;
        std::set<std::string> working_ids;
        for (const auto& assignment : config.at("assignments")) {
            const auto id = assignment.at("staff_id").get<std::string>();
            const auto focus = assignment.at("focus").get<std::string>();
            std::size_t person_index = state.at("company").at("staff").size();
            for (std::size_t i = 0; i < state.at("company").at("staff").size(); ++i) if (state["company"]["staff"][i].at("id") == id) person_index = i;
            require(person_index < state.at("company").at("staff").size());
            const auto& person = state.at("company").at("staff").at(person_index);
            const auto fit = std::string(specialty_of(person)) == required ? rules::specialty_fit : rules::nonspecialty_fit;
            const auto ability = number(person.at("abilities").at(focus), 100);
            auto speed = rules::base_speed * ability * 10;
            speed = scale(speed, fit);
            speed = scale(speed, policy.speed);
            speed = scale(speed, rules::morale_base + rules::morale_scale * static_cast<int>(num(person, "morale")));
            speed = scale(speed, 1000 - rules::fatigue_penalty * static_cast<int>(num(person, "fatigue")));
            const auto points = speed / 1000;
            const auto item_quality = clamp_score(scale(scale(ability, fit), policy.quality));
            work += points;
            quality_sum += points * item_quality;
            working_ids.insert(id);
            state["company"]["staff"][person_index]["experience"][focus] = add(num(state["company"]["staff"][person_index].at("experience").at(focus)), rules::experience_gain[index]);
        }
        const auto workload = static_cast<Integer>(offer_catalog_item(state.at("project").at("offer").at("id").get<std::string>()).workloads[index]);
        const auto gain = std::min(work, workload - old_work);
        auto& stage = state["project"]["stages"][stage_name];
        stage["work_done"] = old_work + gain;
        if (gain > 0 && work > 0) stage["quality"] = clamp_score((old_quality * old_work + gain * (quality_sum / work)) / (old_work + gain));
        if (index > 0) {
            const auto& previous = state.at("project").at("stages").at(rules::stages[index - 1]);
            if (previous.at("status") == "completed") {
                const auto cap = num(previous.at("result"), "quality") * rules::carry_over_permille / 1000 + rules::carry_over_offset;
                stage["quality"] = std::min(num(stage, "quality"), cap);
            }
        }
        for (auto& person : state["company"]["staff"]) {
            const bool busy = working_ids.count(person.at("id").get<std::string>()) > 0;
            const auto morale_before = num(person, "morale");
            const auto fatigue_before = num(person, "fatigue");
            if (busy) {
                person["fatigue"] = std::min<Integer>(100, fatigue_before + rules::fatigue_work);
                const auto extra = config.at("overtime") == true ? rules::overtime_morale : 0;
                person["morale"] = clamp_score(morale_before + policy.morale - extra);
            } else {
                person["fatigue"] = std::max<Integer>(0, fatigue_before - rules::fatigue_rest);
                person["morale"] = clamp_score(morale_before + rules::rest_morale);
            }
        }
        for (const auto& person : state.at("company").at("staff")) {
            const auto id = person.at("id").get<std::string>();
            const auto& before = staff_before[id];
            report["staff_deltas"].push_back(Json::object());
            auto& entry = report["staff_deltas"].back();
            entry["staff_id"] = id;
            Json experience = Json::object();
            for (auto ability : rules::abilities) experience[ability] = num(person.at("experience").at(ability)) - num(before.at("experience").at(ability));
            entry["experience"] = experience;
            entry["fatigue_delta"] = num(person, "fatigue") - num(before, "fatigue");
            entry["morale_delta"] = num(person, "morale") - num(before, "morale");
        }
        report["stage_deltas"].push_back({{"stage", stage_name}, {"work_done_delta", num(stage, "work_done") - old_work}, {"quality_delta", num(stage, "quality") - old_quality}});
        state["company"]["week"] = add(num(state.at("company").at("week")), 1);
        report["week"] = num(state.at("company"), "week");
        report["funds_delta"] = -cost;
        report["costs"]["salary"] = salaries;
        report["costs"]["operations"] = rules::operations_weekly;
        report["costs"]["production"] = production;
        std::string message = u8"第" + std::to_string(report["week"].get<Integer>()) + u8"周制作完成，支出 " + std::to_string(cost) + u8" 日元。";
        if (num(stage, "work_done") >= workload) {
            complete_stage(state, stage_name, index);
            if (index + 1 < static_cast<int>(rules::stages.size())) {
                const auto next = std::string(rules::stages[index + 1]);
                state["project"]["current_stage"] = next;
                state["project"]["stages"][next]["status"] = "ready";
                state["project"]["stages"][next]["recommended_configuration"] = recommended_configuration(state, next);
                message += u8"「" + stage_name + u8"」阶段完成，下一阶段「" + next + u8"」待配置；请配置后再推进。";
            } else {
                state["project"]["delivery_reason"] = "completed";
                state["project"]["current_stage"] = nullptr;
                state["phase"] = "project_ready";
                message += u8"全部五个阶段完成，作品可交付结算。";
            }
        }
        if (state.at("phase") == "producing" && num(state.at("company"), "week") >= num(state.at("project"), "deadline_week")) {
            state["project"]["delivery_reason"] = "deadline";
            state["phase"] = "project_ready";
            message += u8"已到截止周仍未完成全部阶段，按违约交付进入结算。";
        }
        if (num(state.at("company"), "week") == rules::max_weeks) {
            state["company"]["status"] = "closing";
            state["company"]["end_reason"] = "time_limit";
            state["offers"] = Json::array();
            if (state.at("phase") == "producing") {
                state["project"]["delivery_reason"] = "company_closed";
                state["phase"] = "project_ready";
            }
            message += u8"十年经营期满，公司进入结束流程。";
        }
        refresh_preview(state);
        return Json{{"state", state}, {"report", report}};
    });
}

std::string resolve_event(std::string input) {
    return execute(input, [](const Json& state) -> Json {
        (void)state;
        throw ApiError{"INVALID_PHASE", u8"当前没有待处理事件；随机事件库将在后续里程碑开放。"};
    });
}

std::string calculate_result(std::string input) {
    return execute(input, [](const Json& request) {
        auto state = request.at("state");
        const auto scope = text(request.at("scope"));
        if (scope == "project") {
            if (state.at("phase") != "project_ready") wrong_phase();
            const auto& project = state.at("project");
            const auto& offer = project.at("offer");
            const auto id = text(offer.at("id"));
            offer_catalog_item(id);
            const auto reason = text(project.at("delivery_reason"));
            Integer weighted = 0;
            for (std::size_t i = 0; i < rules::stages.size(); ++i) weighted += num(project.at("stages").at(rules::stages[i]), "quality") * rules::quality_weights[i];
            const auto quality = weighted / 1000;
            const auto commercial_score = clamp_score((num(offer, "audience_base") * 300 + num(offer, "commercial_potential") * 300 + quality * 400) / 1000);
            const auto revenue = commercial_score * scale_of(text(offer.at("scale"))).revenue_per_point;
            const auto contract = num(project.at("finance"), "contract_received");
            const auto penalty = reason == "completed" ? static_cast<Integer>(0)
                : reason == "deadline" ? contract * rules::deadline_penalty_permille / 1000
                : contract * rules::closed_penalty_permille / 1000;
            if (penalty > 0) {
                state["company"]["funds"] = sub(num(state.at("company").at("funds")), penalty);
                add_cost(state["company"]["finance"], "penalty", penalty);
                add_cost(state["project"]["finance"], "penalty", penalty);
            }
            const auto target = number(offer.at("target_quality"), 100);
            Integer reputation_delta = 0;
            if (reason == "completed") reputation_delta = quality >= target ? rules::success_reputation : rules::below_target_reputation;
            else if (reason == "deadline") reputation_delta = rules::deadline_reputation;
            const auto reputation = num(state.at("company").at("reputation"));
            state["company"]["reputation"] = reputation_delta >= 0 ? add(reputation, reputation_delta) : std::max<Integer>(0, reputation + reputation_delta);
            auto finance = project.at("finance");
            Json team = Json::array();
            std::set<std::string> seen;
            for (auto stage_name : rules::stages) {
                const auto& stage = project.at("stages").at(stage_name);
                if (stage.at("status") != "completed") continue;
                for (const auto& member : stage.at("result").at("team")) if (seen.insert(member.at("staff_id").get<std::string>()).second) team.push_back(member);
            }
            if (team.empty()) for (const auto& person : state.at("company").at("staff")) team.push_back(team_snapshot(person));
            Json record = {
                {"id", id}, {"name", offer.at("name")}, {"source", offer.at("source")}, {"scale", offer.at("scale")},
                {"previous_work_id", offer.at("previous_work_id")}, {"mode", project.at("mode")}, {"investment_percent", 0},
                {"start_week", project.at("start_week")}, {"end_week", num(state.at("company"), "week")},
                {"end_reason", reason}, {"quality_score", quality}, {"commercial_score", commercial_score},
                {"commercial_revenue", revenue}, {"finance", finance},
                {"profit", sub(num(finance, "contract_received"), costs_total(finance.at("costs")))}, {"team", team}, {"stages", project.at("stages")}
            };
            state["history"].push_back(record);
            state["last_project_id"] = id;
            state["project"] = nullptr;
            state["phase"] = "project_settled";
            if (signed_number(state.at("company").at("funds")) < 0) {
                state["company"]["status"] = "closing";
                state["company"]["end_reason"] = "bankrupt";
                state["preview"] = nullptr;
            } else refresh_preview(state);
            return Json{{"state", std::move(state)}, {"scope", scope}, {"result", std::move(record)}};
        }
        if (scope != "company") invalid();
        if (state.at("company").at("status") == "running" || !state.at("project").is_null() || state.at("company").at("status") == "ended") wrong_phase();
        auto summary = build_summary(state);
        state["company_result"] = summary;
        state["company"]["status"] = "ended";
        state["phase"] = "company_ended";
        state["offers"] = Json::array();
        state["preview"] = nullptr;
        return Json{{"state", std::move(state)}, {"scope", scope}, {"result", std::move(summary)}};
    });
}
}
