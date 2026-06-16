// @ts-check
import tseslint from "typescript-eslint";

// Enforce the backend's layered architecture. Dependencies may flow inward only:
//   http → services → ports / domain
//   adapters → ports / domain
//   bin/ = composition root (may wire anything)
// A layer importing "outward" or "sideways" fails lint, so the structure the refactor
// established can't silently decay. Imports are relative, so each rule denies the
// offending path segment (e.g. **/adapters/**). This config intentionally carries ONLY
// the boundary rules — not a full style ruleset — to keep the wall the single concern.

const deny = (groups, message) => ({
  "no-restricted-imports": ["error", { patterns: [{ group: groups, message }] }],
});

export default tseslint.config(
  {
    files: ["apps/backend/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
  },
  {
    // domain: pure logic, zero I/O — must not reach any other backend layer.
    files: ["apps/backend/src/domain/**/*.ts"],
    rules: deny(
      ["**/adapters/**", "**/services/**", "**/http/**", "**/ports/**", "**/bin/**"],
      "domain is pure logic — it must not import any other backend layer.",
    ),
  },
  {
    // ports: interfaces only — never an implementation.
    files: ["apps/backend/src/ports/**/*.ts"],
    rules: deny(
      ["**/adapters/**", "**/services/**", "**/http/**", "**/bin/**"],
      "ports declare interfaces only — they must not import implementations.",
    ),
  },
  {
    // services: orchestration — depend on ports, never on adapters/http/bin.
    files: ["apps/backend/src/services/**/*.ts"],
    rules: deny(
      ["**/adapters/**", "**/http/**", "**/bin/**"],
      "services depend on ports, not adapters — adapters are injected at the composition root (bin/).",
    ),
  },
  {
    // http: transport — depend on services + ports, never on adapters/bin.
    files: ["apps/backend/src/http/**/*.ts"],
    rules: deny(
      ["**/adapters/**", "**/bin/**"],
      "http depends on services + ports, not adapters — adapters are injected at the composition root (bin/).",
    ),
  },
  {
    // adapters: concrete I/O — implement ports, never depend on services/http/bin.
    files: ["apps/backend/src/adapters/**/*.ts"],
    rules: deny(
      ["**/services/**", "**/http/**", "**/bin/**"],
      "adapters implement ports — they must not depend on services, http, or bin.",
    ),
  },

  // ── frontend: the front/back wall + the UI → hooks → api flow ──
  {
    files: ["apps/frontend/src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: deny(
      ["@stm/backend", "@stm/backend/**"],
      "front/back wall: the frontend talks to the backend only over HTTP (/api/*), never by importing it.",
    ),
  },
  {
    // UI components fetch through hooks/ — they must not reach the api client directly.
    files: ["apps/frontend/src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@stm/backend", "@stm/backend/**"],
              message:
                "front/back wall: the frontend talks to the backend only over HTTP (/api/*), never by importing it.",
            },
            {
              group: ["**/api/**"],
              message: "UI components fetch through hooks/ — don't import the api client directly.",
            },
          ],
        },
      ],
    },
  },
);
