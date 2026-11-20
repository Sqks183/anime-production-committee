#pragma once

#include <string>

namespace apc {

// JSON-in/JSON-out, with no global state, I/O, clock, or system randomness.
std::string advance_day(std::string input);

// Reserved API surface: these operations return NOT_IMPLEMENTED.
std::string initialize_game(std::string input);
std::string start_project(std::string input);
std::string apply_decision(std::string input);
std::string resolve_event(std::string input);
std::string calculate_result(std::string input);

}  // namespace apc
