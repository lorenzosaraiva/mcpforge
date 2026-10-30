import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Intentional, immutable snapshots. Updating these pins is a reviewed source change.
const sources = [
  {
    id: "github",
    repo: "github/rest-api-description",
    commit: "c66e298030d4070b70a569dcd4268b3a041b5380",
    file: "descriptions/api.github.com/api.github.com.json",
    tasks: [
      ["/user", "Get the authenticated user's profile"],
      ["/users/{username}", "Get a public user profile"],
      ["/repos/{owner}/{repo}", "Get repository metadata"],
      ["/repos/{owner}/{repo}/issues", "List repository issues"],
      [
        "/repos/{owner}/{repo}/issues/{issue_number}",
        "Get an issue by its number",
      ],
      ["/repos/{owner}/{repo}/pulls", "List pull requests"],
      [
        "/repos/{owner}/{repo}/pulls/{pull_number}",
        "Get a pull request by its number",
      ],
      ["/repos/{owner}/{repo}/commits", "List repository commits"],
      ["/repos/{owner}/{repo}/branches", "List repository branches"],
      ["/repos/{owner}/{repo}/contributors", "List repository contributors"],
    ],
    noise: ["/meta", "/rate_limit", "/zen"],
  },
  {
    id: "stripe-test",
    repo: "stripe/openapi",
    commit: "51610f5f061c9723730582a7638b8cc0e646640d",
    file: "openapi/spec3.json",
    tasks: [
      ["/v1/customers", "List Stripe customers"],
      ["/v1/customers/{customer}", "Retrieve a Stripe customer"],
      ["/v1/invoices", "List customer invoices"],
      ["/v1/invoices/{invoice}", "Retrieve an invoice"],
      ["/v1/payment_intents", "List payment intents"],
      ["/v1/payment_intents/{intent}", "Retrieve a payment intent"],
      ["/v1/products", "List products"],
      ["/v1/prices", "List prices"],
      ["/v1/subscriptions", "List subscriptions"],
      ["/v1/balance", "Retrieve the Stripe balance"],
    ],
    noise: ["/v1/events", "/v1/country_specs", "/v1/exchange_rates"],
  },
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const strip = (value) => {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !["examples", "example", "externalDocs"].includes(key) &&
          !key.startsWith("x-"),
      )
      .map(([key, item]) => [
        key,
        key === "description" && typeof item === "string"
          ? item.slice(0, 400)
          : strip(item),
      ]),
  );
};
for (const source of sources) {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${source.file}`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `Cannot download pinned ${source.id} specification (${response.status}).`,
    );
  const original = await response.text();
  const upstream = JSON.parse(original);
  if (source.id === "github") {
    // GitHub's OpenAPI snapshot omits authentication declarations. Add the
    // documented token requirement for /user and optional auth for public reads.
    upstream.components ??= {};
    upstream.components.securitySchemes ??= {};
    upstream.components.securitySchemes.githubToken = {
      type: "http",
      scheme: "bearer",
      description:
        "GitHub personal access token; grant only permissions needed for the repositories you read.",
    };
    upstream.security = [{ githubToken: [] }, {}];
    upstream.paths["/user"].get.security = [{ githubToken: [] }];
  }
  if (source.id === "stripe-test") {
    // This pack targets Stripe's default, unexpanded GET responses, not expanded object graphs.
    const narrow = (value) => {
      if (!value || typeof value !== "object") return;
      for (const name of value["x-expandableFields"] ?? []) {
        const property = value.properties?.[name];
        if (!property) continue;
        const key = Array.isArray(property.anyOf)
          ? "anyOf"
          : Array.isArray(property.oneOf)
            ? "oneOf"
            : undefined;
        if (key) {
          const scalars = property[key].filter(
            (branch) => branch.type === "string" || branch.type === "null",
          );
          if (scalars.length) property[key] = scalars;
        }
      }
      for (const item of Object.values(value)) narrow(item);
    };
    narrow(upstream.components);
    for (const item of Object.values(upstream.paths))
      for (const operation of Object.values(item)) {
        if (operation && Array.isArray(operation.parameters))
          operation.parameters = operation.parameters.filter(
            (parameter) => parameter.name !== "expand",
          );
      }
  }
  const paths = {};
  const tasks = [];
  for (const [path, prompt] of source.tasks) {
    if (!upstream.paths[path]?.get)
      throw new Error(`Pinned upstream is missing GET ${path}`);
    const operation = upstream.paths[path].get;
    paths[path] = {
      ...(upstream.paths[path].parameters
        ? { parameters: strip(upstream.paths[path].parameters) }
        : {}),
      get: { ...strip(operation), description: prompt },
    };
    tasks.push({
      id: `${source.id}-${tasks.length + 1}`,
      prompt,
      operationId: operation.operationId,
    });
  }
  for (const path of source.noise)
    if (upstream.paths[path]?.get)
      paths[path] = { get: strip(upstream.paths[path].get) };
  const components = {
    securitySchemes: upstream.components?.securitySchemes ?? {},
  };
  const seen = new Set();
  function collect(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string") {
      const ref = value.$ref;
      if (!ref.startsWith("#/components/"))
        throw new Error(`Unsupported upstream ref ${ref}`);
      if (!seen.has(ref)) {
        seen.add(ref);
        const [, , category, encodedName] = ref.split("/");
        const name = encodedName.replace(/~1/g, "/").replace(/~0/g, "~");
        const definition = upstream.components?.[category]?.[name];
        if (!definition) throw new Error(`Missing upstream definition ${ref}`);
        const compact = strip(definition);
        (components[category] ??= {})[name] = compact;
        collect(compact);
      }
    }
    for (const item of Object.values(value)) collect(item);
  }
  collect(paths);
  const spec = {
    openapi: upstream.openapi,
    info: { title: `${source.id} task pack`, version: upstream.info.version },
    servers: upstream.servers,
    ...(upstream.security ? { security: upstream.security } : {}),
    paths,
    components,
  };
  const contents = `${JSON.stringify(spec, null, 2)}\n`;
  const directory = resolve("benchmarks", "packs", source.id);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "openapi.json"), contents);
  await writeFile(
    resolve(directory, "pack.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: source.id,
        tasks,
        provenance: {
          kind: "upstream-excerpt",
          repository: source.repo,
          commit: source.commit,
          sourceUrl: url,
          sourceSha256: sha256(original),
          specSha256: sha256(contents),
          transformations: [
            "Select the listed GET operations plus three catalog distractors",
            "Include transitive component references",
            "Truncate descriptions to 400 characters and remove examples and vendor extensions",
            ...(source.id === "github"
              ? [
                  "Add documented bearer authentication: required for /user, optional for public reads (https://docs.github.com/en/rest/users/users#get-the-authenticated-user)",
                ]
              : []),
            ...(source.id === "stripe-test"
              ? [
                  "Restrict annotated expandable fields to default string IDs and omit expand query parameters; expanded Stripe responses are outside this pack",
                ]
              : []),
            "Replace selected operation descriptions with reviewed task summaries",
          ],
          verification: "local mock only; no live GitHub or Stripe requests",
          licenseUrl: `https://github.com/${source.repo}/blob/${source.commit}/${source.id === "github" ? "LICENSE.md" : "LICENSE"}`,
        },
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `${source.id}: ${tasks.length} tasks; ${Object.keys(paths).length} paths; ${contents.length} bytes.\n`,
  );
}
