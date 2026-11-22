#include "game_core.hpp"
#include <emscripten/bind.h>

EMSCRIPTEN_BINDINGS(game_core) {
    emscripten::function("initialize_game", &apc::initialize_game);
    emscripten::function("start_project", &apc::start_project);
    emscripten::function("apply_decision", &apc::apply_decision);
    emscripten::function("advance_week", &apc::advance_week);
    emscripten::function("resolve_event", &apc::resolve_event);
    emscripten::function("calculate_result", &apc::calculate_result);
}
