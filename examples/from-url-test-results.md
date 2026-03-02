# `--from-url` Test Results

## Commands run

```bash
MCPFORGE_NON_INTERACTIVE=1 npx tsx packages/cli/src/index.ts init --from-url --dry-run https://petstore3.swagger.io/
MCPFORGE_NON_INTERACTIVE=1 npx tsx packages/cli/src/index.ts init --from-url --dry-run https://jsonplaceholder.typicode.com/
```

## Test 1: Petstore (`https://petstore3.swagger.io/`)

- Result: success
- Docs pages scraped: 2
- Endpoints detected: 19
- Inferred API: `Swagger Petstore - OpenAPI 3.0`
- Inferred auth: `api-key`

Detected endpoints:

1. `update_pet` - `PUT /pet`
2. `add_pet` - `POST /pet`
3. `find_pets_by_status` - `GET /pet/findByStatus`
4. `find_pets_by_tags` - `GET /pet/findByTags`
5. `get_pet_by_id` - `GET /pet/{petId}`
6. `update_pet_with_form` - `POST /pet/{petId}`
7. `delete_pet` - `DELETE /pet/{petId}`
8. `upload_file` - `POST /pet/{petId}/uploadImage`
9. `get_inventory` - `GET /store/inventory`
10. `place_order` - `POST /store/order`
11. `get_order_by_id` - `GET /store/order/{orderId}`
12. `delete_order` - `DELETE /store/order/{orderId}`
13. `create_user` - `POST /user`
14. `create_users_with_list_input` - `POST /user/createWithList`
15. `login_user` - `GET /user/login`
16. `logout_user` - `GET /user/logout`
17. `get_user_by_name` - `GET /user/{username}`
18. `update_user` - `PUT /user/{username}`
19. `delete_user` - `DELETE /user/{username}`

Accuracy notes:

- Endpoint coverage is strong (all core Petstore operations were detected).
- Naming quality is good and MCP-friendly.
- Auth inference is partially correct but simplified (`api-key` only; Petstore also uses OAuth2 in parts of the spec).

## Test 2: JSONPlaceholder (`https://jsonplaceholder.typicode.com/`)

- Result: success
- Docs pages scraped: 1
- Endpoints detected: 8
- Inferred API: `JSONPlaceholder`
- Inferred auth: `none`

Detected endpoints:

1. `get_posts` - `GET /posts`
2. `get_post_by_id` - `GET /posts/{id}`
3. `get_post_comments` - `GET /posts/{id}/comments`
4. `get_comments` - `GET /comments`
5. `create_post` - `POST /posts`
6. `update_post` - `PUT /posts/{id}`
7. `patch_post` - `PATCH /posts/{id}`
8. `delete_post` - `DELETE /posts/{id}`

Accuracy notes:

- All detected endpoints are valid.
- Coverage is partial versus the full JSONPlaceholder surface (`/users`, `/todos`, `/albums`, `/photos` were not inferred from this single docs page).
- For docs-light websites, inference quality tracks what is explicitly documented on the page content.

## Overall observations

- `--from-url` works end-to-end for docs pages without requiring OpenAPI input.
- Discovery quality is high when docs (or linked OpenAPI JSON) expose concrete endpoint details.
- Coverage can be partial on minimal landing pages with limited endpoint examples.
