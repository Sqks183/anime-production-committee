#include "game_core.hpp"
#include "game_rules.hpp"

#include <algorithm>
#include <cstdint>
#include <set>
#include <string>

namespace apc {
namespace {
using Json = nlohmann::json;
using Integer = std::int64_t;
struct ApiError { const char* code; const char* message; };
[[noreturn]] void invalid() { throw ApiError{"INVALID_INPUT", u8"经营数据或操作参数无效。"}; }
void require(bool condition) { if (!condition) invalid(); }
Integer number(const Json& value, Integer max = rules::max_integer, Integer min = 0) {
    require(value.is_number_integer());
    if (value.is_number_unsigned()) require(value.get<std::uint64_t>() <= static_cast<std::uint64_t>(max));
    const auto result = value.get<Integer>();
    require(result >= min && result <= max);
    return result;
}
Integer num(const Json& value, const char* key) { return value.at(key).get<Integer>(); }
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
Integer scale(Integer value, int permille) {
    return (value / 1000) * permille + (value % 1000) * permille / 1000;
}
int clamp(Integer value) { return static_cast<int>(std::clamp<Integer>(value, 0, 100)); }
const rules::Offer& offer(const std::string& id) {
    for (const auto& item : rules::offers) if (id == item.id) return item;
    invalid();
}
Json offers() {
    Json result = Json::array();
    for (const auto& item : rules::offers) result.push_back({{"id", item.id}, {"name", item.name}, {"type", item.type}, {"budget", item.budget}, {"duration_days", item.duration}, {"target_quality", item.quality}, {"min_reputation", item.reputation}});
    return result;
}
const rules::Policy& policy(const Json& id) {
    for (const auto& item : rules::policies) if (id == item.id) return item;
    invalid();
}
bool complete(const Json& project) {
    for (const auto stage : rules::stages) if (project.at("stages").at(stage).at("progress") != 100) return false;
    return true;
}
void validate(const Json& state) {
    require(state.is_object());
    require(number(state.at("version")) == rules::version);
    number(state.at("seed"), rules::max_seed);
    const auto day = number(state.at("day"), rules::max_integer, 1);
    number(state.at("funds")); number(state.at("reputation"));
    const auto& phase = state.at("phase");
    require(one_of(phase, {"idle", "producing", "event_pending", "ended"}));
    const auto& staff = state.at("staff");
    require(staff.is_array() && staff.size() == rules::staff.size());
    std::set<std::string> ids;
    for (const auto& person : staff) {
        const auto id = text(person.at("id"));
        require(ids.insert(id).second);
        const auto spec = std::find_if(rules::staff.begin(), rules::staff.end(), [&](const auto& entry) { return id == entry.id; });
        require(spec != rules::staff.end());
        require(person.at("name") == spec->name && person.at("role") == spec->role);
        require(number(person.at("skill"), 100) == spec->skill);
        number(person.at("morale"), 100);
        require(one_of(person.at("assignment"), {"pre", "mid", "post", "rest"}));
        require(person.at("overtime").is_boolean());
        require(person.at("assignment") != "rest" || person.at("overtime") == false);
    }
    const auto& project = state.at("project");
    const auto& event = state.at("pending_event");
    const auto& reason = state.at("end_reason");
    if (phase == "idle") {
        require(project.is_null() && event.is_null() && reason.is_null());
        require(state.at("offers") == offers());
        return;
    }
    require(project.is_object());
    require(state.at("offers").is_array() && state.at("offers").empty());
    const auto& spec = offer(text(project.at("id")));
    require(project.at("name") == spec.name && project.at("type") == spec.type);
    require(number(project.at("budget")) == spec.budget);
    require(number(project.at("target_quality"), 100) == spec.quality);
    number(project.at("spent"));
    const auto start = number(project.at("start_day"), day, 1);
    const auto deadline = number(project.at("deadline_day"), rules::max_integer, start);
    policy(project.at("policy"));
    Integer upstream = 100;
    for (const auto stage : rules::stages) {
        const auto& item = project.at("stages").at(stage);
        upstream = number(item.at("progress"), upstream);
        number(item.at("quality"), 100);
        require(item.at("outsourced").is_boolean());
    }
    if (phase == "ended") {
        require(event.is_null() && one_of(reason, {"completed", "deadline", "bankrupt"}));
        if (reason == "completed") require(complete(project));
        if (reason == "deadline") require(day > deadline && !complete(project));
        return;
    }
    require(reason.is_null() && day <= deadline && !complete(project));
    if (phase == "event_pending") {
        const auto catalog = rules::events();
        require(std::find(catalog.begin(), catalog.end(), event) != catalog.end());
    } else require(event.is_null());
}
void phase_is(const Json& state, const char* phase) {
    if (state.at("phase") != phase) throw ApiError{"INVALID_PHASE", u8"当前阶段不允许此操作，请先处理事件或结算项目。"};
}
void end_check(Json& state) {
    auto& project = state.at("project");
    if (complete(project)) state["end_reason"] = "completed";
    else if (num(state, "day") > num(project, "deadline_day")) state["end_reason"] = "deadline";
    if (!state.at("end_reason").is_null()) { state["phase"] = "ended"; state["pending_event"] = nullptr; }
}
Integer daily_cost(const Json& state) {
    Integer result = rules::fixed_cost + rules::salary * static_cast<Integer>(state.at("staff").size());
    for (const auto& staff : state.at("staff")) if (staff.at("overtime") == true) result += rules::overtime_cost;
    for (const auto stage : rules::stages) if (state.at("project").at("stages").at(stage).at("outsourced") == true) result += rules::outsource_cost;
    return result;
}
void affordable(Integer funds, Integer cost) {
    if (funds < cost) throw ApiError{"INSUFFICIENT_BUDGET", u8"资金不足，无法承担这项选择。"};
}
Json& staff_by_id(Json& state, const Json& id) {
    for (auto& staff : state.at("staff")) if (staff.at("id") == id) return staff;
    invalid();
}
Json response(Json state, const std::string& message) { return {{"state", std::move(state)}, {"message", message}}; }
template<class Action> std::string execute(const std::string& input, Action action, bool with_state = true) {
    try {
        auto request = Json::parse(input);
        require(request.is_object());
        if (with_state) validate(request.at("state"));
        return action(request).dump();
    } catch (const ApiError& error) {
        return Json{{"error", {{"code", error.code}, {"message", error.message}}}}.dump();
    } catch (const Json::exception&) {
        return Json{{"error", {{"code", "INVALID_INPUT"}, {"message", u8"JSON、字段类型或取值范围无效。"}}}}.dump();
    } catch (...) {
        return R"({"error":{"code":"INTERNAL_ERROR","message":"An internal error occurred."}})";
    }
}
}

std::string initialize_game(std::string input) {
    return execute(input, [](const Json& request) {
        const auto seed = number(request.at("seed"), rules::max_seed);
        Json staff = Json::array();
        for (const auto& item : rules::staff) staff.push_back({{"id", item.id}, {"name", item.name}, {"role", item.role}, {"skill", item.skill}, {"morale", rules::initial_morale}, {"assignment", item.stage}, {"overtime", false}});
        return Json{{"state", {{"version", rules::version}, {"seed", seed}, {"day", 1}, {"funds", rules::initial_funds}, {"reputation", rules::initial_reputation}, {"phase", "idle"}, {"staff", staff}, {"offers", offers()}, {"project", nullptr}, {"pending_event", nullptr}, {"end_reason", nullptr}}}};
    }, false);
}

std::string start_project(std::string input) {
    return execute(input, [](Json& request) {
        auto state = request.at("state");
        phase_is(state, "idle");
        const auto& item = offer(text(request.at("project_id")));
        require(num(state, "reputation") >= item.reputation);
        Json stages;
        for (const auto stage : rules::stages) stages[stage] = {{"progress", 0}, {"quality", 0}, {"outsourced", false}};
        state["project"] = {{"id", item.id}, {"name", item.name}, {"type", item.type}, {"budget", item.budget}, {"spent", 0}, {"start_day", state.at("day")}, {"deadline_day", add(num(state, "day"), item.duration - 1)}, {"target_quality", item.quality}, {"policy", "normal"}, {"stages", stages}};
        state["funds"] = add(num(state, "funds"), item.budget);
        state["offers"] = Json::array(); state["phase"] = "producing";
        return response(state, u8"企划已接手，制作拨款已到账。请安排团队后推进今天。");
    });
}

std::string apply_decision(std::string input) {
    return execute(input, [](Json& request) {
        auto state = request.at("state");
        phase_is(state, "producing");
        const auto& decision = request.at("decision");
        const auto type = text(decision.at("type"));
        if (type == "assign") {
            require(one_of(decision.at("assignment"), {"pre", "mid", "post", "rest"}));
            auto& staff = staff_by_id(state, decision.at("staff_id"));
            staff["assignment"] = decision.at("assignment");
            if (staff.at("assignment") == "rest") staff["overtime"] = false;
        } else if (type == "policy") {
            policy(decision.at("policy")); state["project"]["policy"] = decision.at("policy");
        } else if (type == "outsource") {
            require(one_of(decision.at("stage"), {"pre", "mid", "post"}));
            require(decision.at("enabled").is_boolean());
            state["project"]["stages"][text(decision.at("stage"))]["outsourced"] = decision.at("enabled");
            if (decision.at("enabled") == true) affordable(num(state, "funds"), daily_cost(state));
        } else if (type == "overtime") {
            require(decision.at("enabled").is_boolean());
            auto& staff = staff_by_id(state, decision.at("staff_id"));
            require(staff.at("assignment") != "rest" || decision.at("enabled") == false);
            staff["overtime"] = decision.at("enabled");
            if (decision.at("enabled") == true) affordable(num(state, "funds"), daily_cost(state));
        } else invalid();
        return response(state, u8"当日安排已更新，预计今日支出 " + std::to_string(daily_cost(state)) + u8" 日元；推进前可以继续调整，尚未扣款。");
    });
}

std::string advance_day(std::string input) {
    return execute(input, [](Json& request) {
        auto state = request.at("state");
        phase_is(state, "producing");
        auto& project = state.at("project");
        const auto before = state;
        const auto cost = daily_cost(state);
        Json report{{"day", state.at("day")}, {"funds_delta", 0}, {"stage_deltas", Json::array()}, {"morale_delta", 0}, {"rework", false}, {"message", u8"今天的制作已完成。"}};
        if (num(state, "funds") < cost) {
            state["phase"] = "ended"; state["end_reason"] = "bankrupt";
            report["message"] = u8"资金不足以支付今日制作费用，项目破产。未扣款，日期与种子未推进。";
            return Json{{"state", state}, {"report", report}};
        }
        state["funds"] = num(state, "funds") - cost;
        project["spent"] = add(num(project, "spent"), cost);
        report["funds_delta"] = -cost;
        const auto& plan = policy(project.at("policy"));
        const auto& spec = offer(text(project.at("id")));
        int overtime_count = 0;
        for (const auto& person : state.at("staff")) if (person.at("overtime") == true) ++overtime_count;
        Integer upstream = 100;
        for (const auto stage : rules::stages) {
            auto& item = project["stages"][stage];
            const auto old_progress = num(item, "progress");
            Integer work = 0, quality_sum = 0;
            for (const auto& person : state.at("staff")) {
                if (person.at("assignment") != stage) continue;
                const auto staff_spec = std::find_if(rules::staff.begin(), rules::staff.end(), [&](const auto& entry) { return person.at("id") == entry.id; });
                const int fit = std::string(staff_spec->stage) == stage ? rules::specialty : rules::nonspecialty;
                const bool overtime = person.at("overtime") == true;
                Integer speed = rules::base_speed * num(person, "skill") * 10;
                speed = scale(scale(scale(scale(speed, fit), plan.speed), rules::morale_base + rules::morale_scale * static_cast<int>(num(person, "morale"))), spec.speed);
                if (overtime) speed = scale(speed, rules::overtime_speed);
                const auto points = speed / 1000;
                auto quality = scale(scale(num(person, "skill"), fit), plan.quality);
                if (overtime) quality = scale(quality, rules::overtime_quality);
                work += points; quality_sum += points * clamp(quality);
            }
            if (item.at("outsourced") == true) { work += rules::outsource_progress; quality_sum += rules::outsource_progress * rules::outsource_quality; }
            const auto progress = std::min(upstream, old_progress + work);
            const auto gain = progress - old_progress;
            item["progress"] = progress;
            if (gain > 0) item["quality"] = clamp((num(item, "quality") * old_progress + gain * (quality_sum / work)) / progress);
            upstream = progress;
        }
        for (const auto stage : rules::stages) {
            auto& item = project["stages"][stage];
            if (num(item, "progress") > num(before.at("project").at("stages").at(stage), "progress") && num(item, "quality") < rules::rework_threshold) {
                item["progress"] = std::max<Integer>(0, num(item, "progress") - rules::rework_progress); report["rework"] = true;
            }
        }
        upstream = 100;
        for (const auto stage : rules::stages) {
            auto& item = project["stages"][stage];
            item["progress"] = std::min(upstream, num(item, "progress")); upstream = num(item, "progress");
            item["outsourced"] = false;
            const auto& previous = before.at("project").at("stages").at(stage);
            report["stage_deltas"].push_back({{"stage", stage}, {"progress", num(item, "progress") - num(previous, "progress")}, {"quality", num(item, "quality") - num(previous, "quality")}});
        }
        Integer morale_delta = 0;
        for (auto& person : state.at("staff")) {
            const auto old = num(person, "morale");
            const auto delta = person.at("assignment") == "rest" ? rules::rest_morale : -plan.morale - (person.at("overtime") == true ? rules::overtime_morale : 0);
            person["morale"] = clamp(old + delta); person["overtime"] = false;
            morale_delta += num(person, "morale") - old;
        }
        report["morale_delta"] = morale_delta / static_cast<Integer>(state.at("staff").size());
        state["day"] = add(num(state, "day"), 1);
        const auto seed = static_cast<std::uint32_t>(num(state, "seed")) * rules::rng_multiplier + rules::rng_increment;
        state["seed"] = seed;
        if (seed % 1000 < static_cast<unsigned>(rules::event_chance + overtime_count * rules::overtime_event_chance)) {
            const auto catalog = rules::events(); state["pending_event"] = catalog[(seed / 1000) % catalog.size()]; state["phase"] = "event_pending";
        }
        end_check(state);
        if (state.at("phase") == "ended") report["message"] = u8"项目已到交付节点，请进行经营结算。";
        else if (state.at("phase") == "event_pending") report["message"] = u8"发生制作事件，请作出选择后继续。";
        else if (report.at("rework") == true) report["message"] = u8"部分工序质量偏低，发生返工。";
        return Json{{"state", state}, {"report", report}};
    });
}

std::string resolve_event(std::string input) {
    return execute(input, [](Json& request) {
        auto state = request.at("state"); phase_is(state, "event_pending");
        const auto& options = state.at("pending_event").at("options");
        const auto option = std::find_if(options.begin(), options.end(), [&](const auto& item) { return item.at("id") == request.at("option_id"); });
        require(option != options.end());
        const auto effect = option->at("effect");
        if (effect.contains("funds")) {
            const auto delta = effect.at("funds").get<Integer>();
            if (delta < 0) { affordable(num(state, "funds"), -delta); state["funds"] = num(state, "funds") + delta; state["project"]["spent"] = add(num(state.at("project"), "spent"), -delta); }
            else state["funds"] = add(num(state, "funds"), delta);
        }
        if (effect.contains("deadline_days")) state["project"]["deadline_day"] = add(num(state.at("project"), "deadline_day"), effect.at("deadline_days").get<Integer>());
        if (effect.contains("stage_quality")) {
            const auto& change = effect.at("stage_quality"); auto& item = state["project"]["stages"][text(change.at("stage"))];
            item["quality"] = clamp(num(item, "quality") + change.at("delta").get<Integer>());
        }
        if (effect.contains("morale")) for (auto& person : state.at("staff")) person["morale"] = clamp(num(person, "morale") + effect.at("morale").get<Integer>());
        state["pending_event"] = nullptr; state["phase"] = "producing"; end_check(state);
        return response(state, u8"事件已处理，结果已计入当前经营状态。");
    });
}

std::string calculate_result(std::string input) {
    return execute(input, [](Json& request) {
        auto state = request.at("state"); phase_is(state, "ended");
        const auto& project = state.at("project");
        Integer quality = 0, progress = 0;
        for (std::size_t i = 0; i < rules::stages.size(); ++i) {
            const auto& item = project.at("stages").at(rules::stages[i]);
            quality += num(item, "quality") * rules::quality_weights[i]; progress += num(item, "progress");
        }
        quality /= 1000; progress /= 3;
        auto revenue = scale(scale(num(project, "budget"), static_cast<int>(quality * 10)), static_cast<int>(progress * 10));
        if (quality < num(project, "target_quality")) revenue = scale(revenue, rules::below_target_revenue);
        if (state.at("end_reason") == "deadline") revenue = scale(revenue, rules::deadline_revenue);
        if (state.at("end_reason") == "bankrupt") revenue = 0;
        int reputation_delta = state.at("end_reason") == "completed" && quality >= num(project, "target_quality") ? rules::success_reputation : rules::failure_reputation;
        if (num(project, "spent") > num(project, "budget")) reputation_delta += rules::over_budget_reputation;
        const auto reputation = reputation_delta >= 0 ? add(num(state, "reputation"), reputation_delta) : std::max<Integer>(0, num(state, "reputation") + reputation_delta);
        std::size_t grade = 0;
        while (grade < rules::grade_thresholds.size() && quality < rules::grade_thresholds[grade]) ++grade;
        Json result{{"end_reason", state.at("end_reason")}, {"quality_score", quality}, {"revenue", revenue}, {"cost", project.at("spent")}, {"profit", revenue - num(project, "spent")}, {"reputation_delta", reputation - num(state, "reputation")}, {"grade", rules::grades[grade]}};
        state["funds"] = add(num(state, "funds"), revenue); state["reputation"] = reputation;
        state["project"] = nullptr; state["pending_event"] = nullptr; state["end_reason"] = nullptr; state["phase"] = "idle"; state["offers"] = offers();
        for (auto& person : state.at("staff")) person["overtime"] = false;
        return Json{{"state", state}, {"result", result}};
    });
}
}
