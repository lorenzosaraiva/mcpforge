import type { AuthConfig, MCPForgeIR } from "../core.js";

export function credentialRequirements(
  ir: MCPForgeIR,
  sourceIR: MCPForgeIR = ir,
): Array<{ name: string; description: string }> {
  const schemes: AuthConfig[] = [];
  for (const tool of ir.tools) {
    const endpoints =
      tool.kind === "endpoint"
        ? [tool]
        : tool.steps.map((step) =>
            sourceIR.tools.find(
              (item) =>
                item.kind === "endpoint" &&
                (item.originalOperationId === step.operationId ||
                  item.name === step.operationId),
            ),
          );
    for (const endpoint of endpoints) {
      if (endpoint?.kind !== "endpoint")
        throw new Error(
          "Cannot resolve workflow authentication; regenerate the project.",
        );
      const requirements =
        endpoint.securityRequirements ?? sourceIR.defaultSecurityRequirements;
      if (!requirements) {
        schemes.push(ir.auth);
        continue;
      }
      // OpenAPI alternatives are OR; schemes within an alternative are AND.
      // Prompt for one minimal alternative, and ask for nothing on public routes.
      const alternative = [...requirements].sort(
        (a, b) => a.schemes.length - b.schemes.length,
      )[0];
      for (const reference of alternative?.schemes ?? []) {
        const scheme =
          ir.securitySchemes?.[reference.scheme] ??
          sourceIR.securitySchemes?.[reference.scheme];
        if (!scheme)
          throw new Error(
            "An authentication scheme is missing; repair the specification and regenerate.",
          );
        schemes.push(scheme);
      }
    }
  }
  return [
    ...new Map(
      schemes
        .filter((scheme) => scheme.type !== "none")
        .map((scheme) => [
          scheme.envVarName,
          {
            name: scheme.envVarName,
            description:
              scheme.type === "basic"
                ? "Basic auth (username:password)"
                : scheme.type === "oauth2"
                  ? "OAuth access token (browser login is not supported)"
                  : scheme.type === "bearer"
                    ? "Bearer token (without the Bearer prefix)"
                    : "API key",
          },
        ]),
    ).values(),
  ];
}

/** Only a presence check: no credential is returned or sent to a provider. */
export function credentialsPresent(
  ir: MCPForgeIR,
  sourceIR: MCPForgeIR,
  environment: Record<string, string | undefined>,
): boolean {
  const present = (scheme: AuthConfig | undefined): boolean => {
    if (!scheme) return false;
    if (scheme.type === "none" || environment[scheme.envVarName]?.trim())
      return true;
    return (
      scheme.type === "oauth2" &&
      Boolean(
        (environment.OAUTH_TOKEN_URL?.trim() ||
          scheme.tokenUrl?.trim() ||
          scheme.refreshUrl?.trim()) &&
        (environment.OAUTH_REFRESH_TOKEN?.trim() ||
          (environment.OAUTH_CLIENT_ID?.trim() &&
            environment.OAUTH_CLIENT_SECRET?.trim())),
      )
    );
  };
  return ir.tools.every((tool) => {
    const endpoints =
      tool.kind === "endpoint"
        ? [tool]
        : tool.steps.map((step) =>
            sourceIR.tools.find(
              (item) =>
                item.kind === "endpoint" &&
                (item.originalOperationId === step.operationId ||
                  item.name === step.operationId),
            ),
          );
    return endpoints.every((endpoint) => {
      if (endpoint?.kind !== "endpoint") return false;
      const requirements =
        endpoint.securityRequirements ?? sourceIR.defaultSecurityRequirements;
      if (!requirements) return present(ir.auth);
      return (
        requirements.length === 0 ||
        requirements.some((alternative) =>
          alternative.schemes.every((item) =>
            present(ir.securitySchemes?.[item.scheme]),
          ),
        )
      );
    });
  });
}
