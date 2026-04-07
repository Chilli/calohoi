const { KASSAL_BASE_URL, getApiKey, json, mapSearchProduct } = require('./_kassal.cjs')

module.exports.handler = async (event) => {
  const apiKey = getApiKey()
  if (!apiKey) {
    return json(500, { error: 'KASSAL_API_KEY is not configured' })
  }

  const q = String(event.queryStringParameters?.q ?? '').trim()
  if (!q) {
    return json(200, [])
  }

  const url = `${KASSAL_BASE_URL}/products?search=${encodeURIComponent(q)}&size=20`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (res.status === 429) {
    return json(200, [])
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return json(res.status >= 500 ? 502 : res.status, {
      error: 'Kassal search failed',
      status: res.status,
      body: body.slice(0, 500),
    })
  }

  const data = await res.json()
  const products = Array.isArray(data?.data) ? data.data : []
  const items = products.map(mapSearchProduct).filter(Boolean)
  return json(200, items)
}
