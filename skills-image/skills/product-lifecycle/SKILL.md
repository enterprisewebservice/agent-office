---
name: product-lifecycle
description: Query Red Hat Product Life Cycle data for support phases, end-of-life dates, and OpenShift version compatibility. Use when evaluating whether installed operators or layered products are supported on a given OCP version, approaching end of life, or need upgrading before a cluster upgrade. Also use when the user asks about product support status, EOL dates, or lifecycle phases for any Red Hat product.
---

# Red Hat Product Life Cycle

Query the Red Hat Product Life Cycle API to check support status, EOL dates, and OpenShift compatibility for Red Hat products and layered operators.

## API Overview

- **Base URL**: `https://access.redhat.com/product-life-cycles/api/v1/products`
- **Authentication**: None required — the API is public.
- **Query parameter**: `?name=<substring>` — case-insensitive substring match on product name.
- **Response**: `{ "data": [ { product }, ... ] }` — array of matching products.

## Quick Start

```bash
# Search for a product by name (substring match)
curl -s "https://access.redhat.com/product-life-cycles/api/v1/products?name=logging+for+Red+Hat+OpenShift" | jq .

# List all products with "OpenShift" in the name
curl -s "https://access.redhat.com/product-life-cycles/api/v1/products?name=OpenShift" | jq -r '.data[].name'
```

## Response Structure

Each product in `data[]` has:

```json
{
  "name": "logging for Red Hat OpenShift",
  "former_names": ["Red Hat OpenShift Logging"],
  "all_phases": [{"name": "General availability", ...}, ...],
  "versions": [
    {
      "name": "6.5",
      "type": "Full Support",
      "openshift_compatibility": "4.19, 4.20, 4.21",
      "phases": [
        {
          "name": "General availability",
          "end_date": "2026-04-01T00:00:00.000Z",
          "date_format": "date"
        },
        {
          "name": "Full support",
          "end_date": "Release of Logging 6.6 + 1 month",
          "date_format": "string"
        },
        {
          "name": "Maintenance support",
          "end_date": "Release of Logging 6.7",
          "date_format": "string"
        }
      ]
    }
  ]
}
```

For full field descriptions, type enumerations, and phase name details, see `references/api-details.md`.

## Common Queries

### Check support status for a specific product version

```bash
curl -s "https://access.redhat.com/product-life-cycles/api/v1/products?name=logging+for+Red+Hat+OpenShift" \
  | jq -r '.data[] | "\(.name)", (.versions[] | "  \(.name) - \(.type) (OCP: \(.openshift_compatibility // "N/A"))")'
```

### Check if a product version is compatible with a target OCP version

```bash
TARGET_OCP="4.21"
PRODUCT="logging+for+Red+Hat+OpenShift"

curl -s "https://access.redhat.com/product-life-cycles/api/v1/products?name=$PRODUCT" \
  | jq -r --arg target "$TARGET_OCP" '
    .data[] | .name as $prod |
    .versions[] |
    .name as $ver | .type as $type |
    (.openshift_compatibility // "" | split(", ")) as $compat |
    (if ($compat | index($target)) then "COMPATIBLE" else "NOT COMPATIBLE" end) as $status |
    "\($prod) \($ver) (\($type)) - \($status) with OCP \($target)"'
```

### Get EOL dates for OCP itself

```bash
curl -s "https://access.redhat.com/product-life-cycles/api/v1/products?name=OpenShift+Container+Platform" \
  | jq -r '.data[0].versions[] |
    "OCP \(.name) - \(.type) (maintenance ends: \(
      [.phases[] | select(.name == "Maintenance support") | .end_date] | first // "N/A"
    ))"'
```

### Cross-reference OLM operators with Product Life Cycle data

Products that are OLM operators have a `package` field that maps directly to the
OLM Subscription's `spec.name`. This is an **exact match key** — more reliable than name
matching. The `is_operator` field confirms the product is OLM-managed.

When the upgrade advisor readiness JSON includes `olm_operator_lifecycle` data:

1. Extract the `package` name from each operator in readiness data
2. Search the Product Life Cycle API using that package name
3. Match by comparing `product.package` == operator's `package`
4. Check if the installed version's `openshift_compatibility` includes the target OCP version
5. Check the `type` field for support status

```bash
# Look up Product Life Cycle data for an OLM operator by its package name
OLM_PACKAGE="cluster-logging"
TARGET_OCP="4.21"

curl -s "https://access.redhat.com/product-life-cycles/api/v1/products?name=logging" \
  | jq -r --arg pkg "$OLM_PACKAGE" --arg target "$TARGET_OCP" '
    [.data[] | select(.package == $pkg)] |
    if length == 0 then "No Product Life Cycle entry with package=\($pkg)"
    else .[0] |
      "\(.name) (package: \(.package))",
      (.versions[] |
        .name as $ver | .type as $type |
        (.openshift_compatibility // "" | split(", ")) as $compat |
        (if ($compat | index($target)) then "YES" else "NO" end) as $ok |
        "  \($ver) - \($type) - OCP \($target) compatible: \($ok)")
    end'
```

If the `?name=` search doesn't return the operator, try searching by `csv_display_name`
from the readiness data as a fallback.

**Not all operators have Product Life Cycle entries.** If a search returns no results, that's expected —
it means the product isn't tracked in the Product Life Cycle API. Report this as "lifecycle data unavailable"
rather than an error.

### Batch lookup for multiple OLM operators

When cross-referencing several operators, avoid N+1 API calls. Fetch `?name=OpenShift`
once (~14 products covering most Red Hat layered operators), then make individual calls
only for operators not found in that initial batch.

```bash
TARGET_OCP="4.21"

# Single call covers most Red Hat operator products
curl -s "https://access.redhat.com/product-life-cycles/api/v1/products?name=OpenShift" \
  | jq -r --arg target "$TARGET_OCP" '
    .data[] | select(.is_operator) |
    (.package // "") as $pkg | .name as $prod |
    .versions[] |
    .name as $ver | .type as $type |
    (.openshift_compatibility // "" | split(", ")) as $compat |
    (if ($compat | index($target)) then "YES" else "NO" end) as $ok |
    "\($pkg): \($prod) \($ver) (\($type)) - OCP \($target): \($ok)"'
```

## Important

- **Always use `?name=`** to filter — never fetch the unfiltered `/products` endpoint.
- `openshift_compatibility` is only present on **layered product** versions, not on OCP itself.
- When cross-referencing with OLM data, a missing Product Life Cycle entry is normal — report "lifecycle data unavailable" and move on.
