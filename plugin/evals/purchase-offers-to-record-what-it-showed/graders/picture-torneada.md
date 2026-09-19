---
type: tool_used
# Matched on the call, not judged. Cama con Sabanera Torneada Patas 3x3 acabado miel, product 147661956.
# Falabella serves its picture under the SKU's id, 147661957, not the product id in the page's
# address, so a link built from the address is not this product's picture; only one read off
# its own page passes. Any transform counts (/public, /w=1200,h=1200,fit=cover, and so on).
tool: mcp__settle__record_listing
input_match: '"photoUrl"\s*:\s*"https://media\.falabella\.com(\.pe)?/falabellaPE/147661957_[^"]*"'
min: 1
---
