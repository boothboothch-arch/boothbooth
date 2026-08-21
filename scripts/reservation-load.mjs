const baseUrl = process.env.LOAD_TEST_URL ?? 'http://localhost:3000'
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 500)

const initialResponse = await fetch(`${baseUrl}/api/public/sale-status`, { cache: 'no-store' })
if (!initialResponse.ok) throw new Error(`판매 상태 확인 실패: ${initialResponse.status}`)
const initial = await initialResponse.json()
if (initial.phase !== 'open') throw new Error(`판매 상태가 open이어야 합니다. 현재 상태: ${initial.phase}`)

const attempts = await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
  const response = await fetch(`${baseUrl}/api/reservations`, {
    method: 'POST',
    headers: { 'x-forwarded-for': `198.51.${Math.floor(index / 250)}.${(index % 250) + 1}` },
  })
  return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null }
}))

const successes = attempts.filter((attempt) => attempt.status === 200)
const expectedMaximum = Math.min(concurrency, initial.remainingCount)
const after = await (await fetch(`${baseUrl}/api/public/sale-status`, { cache: 'no-store' })).json()
const statusCounts = Object.fromEntries([...new Set(attempts.map((attempt) => attempt.status))].map((status) => [status, attempts.filter((attempt) => attempt.status === status).length]))

console.log(JSON.stringify({ concurrency, initialRemaining: initial.remainingCount, successCount: successes.length, statusCounts, afterRemaining: after.remainingCount }, null, 2))

await Promise.all(successes.map((attempt) => fetch(`${baseUrl}/api/reservations/release`, { method: 'POST', headers: attempt.cookie ? { cookie: attempt.cookie } : {} })))

if (successes.length > expectedMaximum) throw new Error(`초과 예약 발생: 최대 ${expectedMaximum}, 실제 ${successes.length}`)
if (after.remainingCount < 0) throw new Error(`음수 잔여 수량 발생: ${after.remainingCount}`)
if (successes.length !== expectedMaximum) throw new Error(`예약 손실 발생: 예상 ${expectedMaximum}, 실제 ${successes.length}`)

