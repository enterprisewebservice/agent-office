Use this skill to produce **${{ values.oneliner }}** using the governed tools listed below. Everything goes through the **governed MCP gateway**: you never touch backing systems directly and never hold a credential; you call the named tools and work with what they return.

## When to use

${{ values.when_to_use }}

## When NOT to use

${{ values.when_not | default("- Requests outside the procedure below — answer those with the individual governed tools directly.", true) }}
- Anything that would modify backing systems this skill only reads from.

## Procedure

${{ values.procedure }}

## Output format

${{ values.output_format | default("Keep the result tight and structured; lead with the numbers, then the flags.", true) }}

## Governed tools this skill calls

{% for t in values.tools %}- `${{ t }}`
{% endfor %}
