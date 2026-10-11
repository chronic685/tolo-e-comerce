/**
 * Query-string parameters for an endpoint whose parameters the API's OpenAPI document does not declare yet (most list endpoints read them
 * straight from the query string). Undefined/null/empty values are dropped. Remove its uses when the API declares the parameters, and the
 * generated types will check them instead.
 *
 *   client.GET("/api/customer/products", withQuery({ q: "shoe", page: 2 }))
 */
export function withQuery(query: Record<string, string | number | boolean | null | undefined>): { params: { query: undefined } } {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") clean[key] = value;
  }
  // Typed as "no query" because the generated types declare none for these endpoints; at run time it carries the real parameters.
  return { params: { query: clean } } as unknown as { params: { query: undefined } };
}
