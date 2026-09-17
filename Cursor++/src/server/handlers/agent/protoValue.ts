import type { Value } from '@bufbuild/protobuf/wkt'
import { create } from '@bufbuild/protobuf'
import { ListValueSchema, NullValue, StructSchema, ValueSchema } from '@bufbuild/protobuf/wkt'

export function toProtoValue(input: unknown): Value {
  if (input === null || input === undefined) {
    return create(ValueSchema, {
      kind: {
        case: 'nullValue',
        value: NullValue.NULL_VALUE,
      },
    })
  }

  switch (typeof input) {
    case 'string':
      return create(ValueSchema, {
        kind: {
          case: 'stringValue',
          value: input,
        },
      })
    case 'number':
      return create(ValueSchema, {
        kind: {
          case: 'numberValue',
          value: Number.isFinite(input) ? input : 0,
        },
      })
    case 'boolean':
      return create(ValueSchema, {
        kind: {
          case: 'boolValue',
          value: input,
        },
      })
    case 'object':
      if (Array.isArray(input)) {
        return create(ValueSchema, {
          kind: {
            case: 'listValue',
            value: create(ListValueSchema, {
              values: input.map(toProtoValue),
            }),
          },
        })
      }
      return create(ValueSchema, {
        kind: {
          case: 'structValue',
          value: create(StructSchema, {
            fields: Object.fromEntries(
              Object.entries(input).map(([key, value]) => [key, toProtoValue(value)]),
            ),
          }),
        },
      })
    default:
      return create(ValueSchema, {
        kind: {
          case: 'stringValue',
          value: String(input),
        },
      })
  }
}

export function toProtoValueMap(input: Record<string, unknown>): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, toProtoValue(value)]),
  )
}
