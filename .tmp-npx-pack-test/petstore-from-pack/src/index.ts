#!/usr/bin/env node

import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { AUTH_CONFIG, getAuthHeaders } from "./auth.js";
import { handleUpdatePet } from "./tools/update_pet.js";
import { handleAddPet } from "./tools/add_pet.js";
import { handleFindPetsByStatus } from "./tools/find_pets_by_status.js";
import { handleFindPetsByTags } from "./tools/find_pets_by_tags.js";
import { handleGetPetById } from "./tools/get_pet_by_id.js";
import { handleUpdatePetWithForm } from "./tools/update_pet_with_form.js";
import { handleDeletePet } from "./tools/delete_pet.js";
import { handleUploadFile } from "./tools/upload_file.js";
import { handleGetInventory } from "./tools/get_inventory.js";
import { handlePlaceOrder } from "./tools/place_order.js";
import { handleGetOrderById } from "./tools/get_order_by_id.js";
import { handleDeleteOrder } from "./tools/delete_order.js";
import { handleCreateUser } from "./tools/create_user.js";
import { handleCreateUsersWithListInput } from "./tools/create_users_with_list_input.js";
import { handleLoginUser } from "./tools/login_user.js";
import { handleLogoutUser } from "./tools/logout_user.js";
import { handleGetUserByName } from "./tools/get_user_by_name.js";
import { handleUpdateUser } from "./tools/update_user.js";
import { handleDeleteUser } from "./tools/delete_user.js";

const SERVER_NAME = "petstore-from-pack";
const SERVER_VERSION = "0.1.0";
const DEFAULT_API_BASE_URL = "https://petstore3.swagger.io/api/v3";
const API_BASE_URL = process.env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
const AUTH_RESOLUTION = getAuthHeaders(AUTH_CONFIG);
if (AUTH_RESOLUTION.startupWarning) {
  process.stderr.write(`${AUTH_RESOLUTION.startupWarning}\n`);
}
const AUTH_HEADERS = AUTH_RESOLUTION.headers;

const TOOL_DEFINITIONS = [
  {
    name: "update_pet",
    description: "Update an existing pet. Update an existing pet by Id.",
    inputSchema: {
  "type": "object",
  "properties": {
    "body": {
      "required": [
        "name",
        "photoUrls"
      ],
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64",
          "example": 10
        },
        "name": {
          "type": "string",
          "example": "doggie"
        },
        "category": {
          "type": "object",
          "properties": {
            "id": {
              "type": "integer",
              "format": "int64",
              "example": 1
            },
            "name": {
              "type": "string",
              "example": "Dogs"
            }
          },
          "xml": {
            "name": "category"
          }
        },
        "photoUrls": {
          "type": "array",
          "xml": {
            "wrapped": true
          },
          "items": {
            "type": "string",
            "xml": {
              "name": "photoUrl"
            }
          }
        },
        "tags": {
          "type": "array",
          "xml": {
            "wrapped": true
          },
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "integer",
                "format": "int64"
              },
              "name": {
                "type": "string"
              }
            },
            "xml": {
              "name": "tag"
            }
          }
        },
        "status": {
          "type": "string",
          "description": "pet status in the store",
          "enum": [
            "available",
            "pending",
            "sold"
          ]
        }
      },
      "xml": {
        "name": "pet"
      }
    }
  },
  "additionalProperties": false,
  "required": [
    "body"
  ]
},
  },
  {
    name: "add_pet",
    description: "Add a new pet to the store. Add a new pet to the store.",
    inputSchema: {
  "type": "object",
  "properties": {
    "body": {
      "required": [
        "name",
        "photoUrls"
      ],
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64",
          "example": 10
        },
        "name": {
          "type": "string",
          "example": "doggie"
        },
        "category": {
          "type": "object",
          "properties": {
            "id": {
              "type": "integer",
              "format": "int64",
              "example": 1
            },
            "name": {
              "type": "string",
              "example": "Dogs"
            }
          },
          "xml": {
            "name": "category"
          }
        },
        "photoUrls": {
          "type": "array",
          "xml": {
            "wrapped": true
          },
          "items": {
            "type": "string",
            "xml": {
              "name": "photoUrl"
            }
          }
        },
        "tags": {
          "type": "array",
          "xml": {
            "wrapped": true
          },
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "integer",
                "format": "int64"
              },
              "name": {
                "type": "string"
              }
            },
            "xml": {
              "name": "tag"
            }
          }
        },
        "status": {
          "type": "string",
          "description": "pet status in the store",
          "enum": [
            "available",
            "pending",
            "sold"
          ]
        }
      },
      "xml": {
        "name": "pet"
      }
    }
  },
  "additionalProperties": false,
  "required": [
    "body"
  ]
},
  },
  {
    name: "find_pets_by_status",
    description: "Finds Pets by status. Multiple status values can be provided with comma separated strings.",
    inputSchema: {
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Status values that need to be considered for filter",
      "enum": [
        "available",
        "pending",
        "sold"
      ],
      "default": "available"
    }
  },
  "additionalProperties": false,
  "required": [
    "status"
  ]
},
  },
  {
    name: "find_pets_by_tags",
    description: "Finds Pets by tags. Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for testing.",
    inputSchema: {
  "type": "object",
  "properties": {
    "tags": {
      "type": "array",
      "description": "Tags to filter by"
    }
  },
  "additionalProperties": false,
  "required": [
    "tags"
  ]
},
  },
  {
    name: "get_pet_by_id",
    description: "Find pet by ID. Returns a single pet.",
    inputSchema: {
  "type": "object",
  "properties": {
    "petId": {
      "type": "integer",
      "description": "ID of pet to return"
    }
  },
  "additionalProperties": false,
  "required": [
    "petId"
  ]
},
  },
  {
    name: "update_pet_with_form",
    description: "Updates a pet in the store with form data. Updates a pet resource based on the form data.",
    inputSchema: {
  "type": "object",
  "properties": {
    "petId": {
      "type": "integer",
      "description": "ID of pet that needs to be updated"
    },
    "name": {
      "type": "string",
      "description": "Name of pet that needs to be updated"
    },
    "status": {
      "type": "string",
      "description": "Status of pet that needs to be updated"
    }
  },
  "additionalProperties": false,
  "required": [
    "petId"
  ]
},
  },
  {
    name: "delete_pet",
    description: "Deletes a pet. Delete a pet.",
    inputSchema: {
  "type": "object",
  "properties": {
    "api_key": {
      "type": "string",
      "description": "header parameter \"api_key\""
    },
    "petId": {
      "type": "integer",
      "description": "Pet id to delete"
    }
  },
  "additionalProperties": false,
  "required": [
    "petId"
  ]
},
  },
  {
    name: "upload_file",
    description: "Uploads an image. Upload image of the pet.",
    inputSchema: {
  "type": "object",
  "properties": {
    "petId": {
      "type": "integer",
      "description": "ID of pet to update"
    },
    "additionalMetadata": {
      "type": "string",
      "description": "Additional Metadata"
    },
    "body": {
      "type": "string",
      "format": "binary"
    }
  },
  "additionalProperties": false,
  "required": [
    "petId"
  ]
},
  },
  {
    name: "get_inventory",
    description: "Returns pet inventories by status. Returns a map of status codes to quantities.",
    inputSchema: {
  "type": "object",
  "properties": {},
  "additionalProperties": false
},
  },
  {
    name: "place_order",
    description: "Place an order for a pet. Place a new order in the store.",
    inputSchema: {
  "type": "object",
  "properties": {
    "body": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64",
          "example": 10
        },
        "petId": {
          "type": "integer",
          "format": "int64",
          "example": 198772
        },
        "quantity": {
          "type": "integer",
          "format": "int32",
          "example": 7
        },
        "shipDate": {
          "type": "string",
          "format": "date-time"
        },
        "status": {
          "type": "string",
          "description": "Order Status",
          "example": "approved",
          "enum": [
            "placed",
            "approved",
            "delivered"
          ]
        },
        "complete": {
          "type": "boolean"
        }
      },
      "xml": {
        "name": "order"
      }
    }
  },
  "additionalProperties": false
},
  },
  {
    name: "get_order_by_id",
    description: "Find purchase order by ID. For valid response try integer IDs with value <= 5 or > 10. Other values will generate exceptions.",
    inputSchema: {
  "type": "object",
  "properties": {
    "orderId": {
      "type": "integer",
      "description": "ID of order that needs to be fetched"
    }
  },
  "additionalProperties": false,
  "required": [
    "orderId"
  ]
},
  },
  {
    name: "delete_order",
    description: "Delete purchase order by identifier. For valid response try integer IDs with value < 1000. Anything above 1000 or non-integers will generate API errors.",
    inputSchema: {
  "type": "object",
  "properties": {
    "orderId": {
      "type": "integer",
      "description": "ID of the order that needs to be deleted"
    }
  },
  "additionalProperties": false,
  "required": [
    "orderId"
  ]
},
  },
  {
    name: "create_user",
    description: "Create user. This can only be done by the logged in user.",
    inputSchema: {
  "type": "object",
  "properties": {
    "body": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64",
          "example": 10
        },
        "username": {
          "type": "string",
          "example": "theUser"
        },
        "firstName": {
          "type": "string",
          "example": "John"
        },
        "lastName": {
          "type": "string",
          "example": "James"
        },
        "email": {
          "type": "string",
          "example": "john@email.com"
        },
        "password": {
          "type": "string",
          "example": "12345"
        },
        "phone": {
          "type": "string",
          "example": "12345"
        },
        "userStatus": {
          "type": "integer",
          "description": "User Status",
          "format": "int32",
          "example": 1
        }
      },
      "xml": {
        "name": "user"
      }
    }
  },
  "additionalProperties": false
},
  },
  {
    name: "create_users_with_list_input",
    description: "Creates list of users with given input array. Creates list of users with given input array.",
    inputSchema: {
  "type": "object",
  "properties": {
    "body": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "format": "int64",
            "example": 10
          },
          "username": {
            "type": "string",
            "example": "theUser"
          },
          "firstName": {
            "type": "string",
            "example": "John"
          },
          "lastName": {
            "type": "string",
            "example": "James"
          },
          "email": {
            "type": "string",
            "example": "john@email.com"
          },
          "password": {
            "type": "string",
            "example": "12345"
          },
          "phone": {
            "type": "string",
            "example": "12345"
          },
          "userStatus": {
            "type": "integer",
            "description": "User Status",
            "format": "int32",
            "example": 1
          }
        },
        "xml": {
          "name": "user"
        }
      }
    }
  },
  "additionalProperties": false
},
  },
  {
    name: "login_user",
    description: "Logs user into the system. Log into the system.",
    inputSchema: {
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "description": "The user name for login"
    },
    "password": {
      "type": "string",
      "description": "The password for login in clear text"
    }
  },
  "additionalProperties": false
},
  },
  {
    name: "logout_user",
    description: "Logs out current logged in user session. Log user out of the system.",
    inputSchema: {
  "type": "object",
  "properties": {},
  "additionalProperties": false
},
  },
  {
    name: "get_user_by_name",
    description: "Get user by user name. Get user detail based on username.",
    inputSchema: {
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "description": "The name that needs to be fetched. Use user1 for testing"
    }
  },
  "additionalProperties": false,
  "required": [
    "username"
  ]
},
  },
  {
    name: "update_user",
    description: "Update user resource. This can only be done by the logged in user.",
    inputSchema: {
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "description": "name that need to be deleted"
    },
    "body": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer",
          "format": "int64",
          "example": 10
        },
        "username": {
          "type": "string",
          "example": "theUser"
        },
        "firstName": {
          "type": "string",
          "example": "John"
        },
        "lastName": {
          "type": "string",
          "example": "James"
        },
        "email": {
          "type": "string",
          "example": "john@email.com"
        },
        "password": {
          "type": "string",
          "example": "12345"
        },
        "phone": {
          "type": "string",
          "example": "12345"
        },
        "userStatus": {
          "type": "integer",
          "description": "User Status",
          "format": "int32",
          "example": 1
        }
      },
      "xml": {
        "name": "user"
      }
    }
  },
  "additionalProperties": false,
  "required": [
    "username"
  ]
},
  },
  {
    name: "delete_user",
    description: "Delete user resource. This can only be done by the logged in user.",
    inputSchema: {
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "description": "The name that needs to be deleted"
    }
  },
  "additionalProperties": false,
  "required": [
    "username"
  ]
},
  }
];

const TOOL_HANDLERS: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
  "update_pet": (input) =>
    handleUpdatePet(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "add_pet": (input) =>
    handleAddPet(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "find_pets_by_status": (input) =>
    handleFindPetsByStatus(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "find_pets_by_tags": (input) =>
    handleFindPetsByTags(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "get_pet_by_id": (input) =>
    handleGetPetById(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "update_pet_with_form": (input) =>
    handleUpdatePetWithForm(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "delete_pet": (input) =>
    handleDeletePet(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "upload_file": (input) =>
    handleUploadFile(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "get_inventory": (input) =>
    handleGetInventory(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "place_order": (input) =>
    handlePlaceOrder(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "get_order_by_id": (input) =>
    handleGetOrderById(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "delete_order": (input) =>
    handleDeleteOrder(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "create_user": (input) =>
    handleCreateUser(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "create_users_with_list_input": (input) =>
    handleCreateUsersWithListInput(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "login_user": (input) =>
    handleLoginUser(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "logout_user": (input) =>
    handleLogoutUser(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "get_user_by_name": (input) =>
    handleGetUserByName(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "update_user": (input) =>
    handleUpdateUser(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    }),
  "delete_user": (input) =>
    handleDeleteUser(input, {
      baseUrl: API_BASE_URL,
      authHeaders: AUTH_HEADERS,
    })
};

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOL_DEFINITIONS,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const toolName = request.params.name;
  const rawArgs = request.params.arguments;
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  const toolHandler = TOOL_HANDLERS[toolName];

  if (!toolHandler) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Unknown tool: ${toolName}`,
        },
      ],
    };
  }

  try {
    const result = await toolHandler(args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution error";
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Tool "${toolName}" failed: ${message}`,
        },
      ],
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`MCP server failed to start: ${message}\n`);
  process.exit(1);
});
