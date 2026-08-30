// 安全な算術式の評価（純関数・テスト対象）。
//
// 役割: calculate ツールの本体。数値と + - * / % ^ ( ) だけを受け付ける再帰下降パーサで評価する。
//       eval / new Function を使わないので CSP に 'unsafe-eval' が不要。
// 関係: tools/example/handlers.js が使う。
//
// 文法: expr := term (('+'|'-') term)* / term := unary (('*'|'/'|'%') unary)* /
//       unary := '-' unary | power / power := primary ('^' unary)? （右結合。-2^2 は -(2^2) = -4）/
//       primary := number | '(' expr ')'
export const MAX_EXPRESSION_LENGTH = 200

function tokenize(expression) {
  const tokens = []
  let i = 0
  while (i < expression.length) {
    const ch = expression[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const m = expression.slice(i).match(/^(\d+\.?\d*|\.\d+)/)
      if (!m) throw new Error(`数値の形式が不正です（位置 ${i}）`)
      tokens.push({ type: 'num', value: Number(m[0]) })
      i += m[0].length
      continue
    }
    if ('+-*/%^()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }
    throw new Error(`使えない文字です: "${ch}"（数値と + - * / % ^ ( ) だけが使えます）`)
  }
  return tokens
}

export function evaluateArithmetic(expression) {
  const src = String(expression ?? '').trim()
  if (!src) throw new Error('式が空です')
  if (src.length > MAX_EXPRESSION_LENGTH) throw new Error(`式が長すぎます（${MAX_EXPRESSION_LENGTH} 文字まで）`)
  const tokens = tokenize(src)
  let pos = 0
  const peek = () => tokens[pos]
  const takeOp = (...ops) => {
    const t = tokens[pos]
    if (t?.type === 'op' && ops.includes(t.value)) {
      pos += 1
      return t.value
    }
    return null
  }

  function primary() {
    const t = peek()
    if (!t) throw new Error('式が途中で終わっています')
    if (t.type === 'num') {
      pos += 1
      return t.value
    }
    if (takeOp('(')) {
      const v = expr()
      if (!takeOp(')')) throw new Error('閉じ括弧 ) がありません')
      return v
    }
    throw new Error(`予期しない記号です: "${t.value}"`)
  }
  function power() {
    const base = primary()
    if (takeOp('^')) return base ** unary()
    return base
  }
  function unary() {
    if (takeOp('-')) return -unary()
    return power()
  }
  function term() {
    let v = unary()
    let op
    while ((op = takeOp('*', '/', '%'))) {
      const r = unary()
      if (op === '*') v *= r
      else if (r === 0) throw new Error('0 で割ることはできません')
      else v = op === '/' ? v / r : v % r
    }
    return v
  }
  function expr() {
    let v = term()
    let op
    while ((op = takeOp('+', '-'))) {
      const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }

  const result = expr()
  if (pos < tokens.length) throw new Error(`式の末尾に余分な記号があります: "${tokens[pos].value}"`)
  if (!Number.isFinite(result)) throw new Error('結果が数値になりません（無限大や NaN）')
  return result
}
