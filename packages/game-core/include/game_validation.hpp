#pragma once

#include <nlohmann/json.hpp>

namespace apc {
void validate_state(const nlohmann::json& state);
}
