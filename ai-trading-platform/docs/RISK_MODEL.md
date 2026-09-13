# Risk Model

**AI Trading Platform — Risk Management Framework**

> The Risk Engine is the highest-priority component in this system.
> It has **absolute veto authority** over the Strategy Engine and AI Engine.
> No trade can be executed without Risk Engine approval.

---

## 1. Risk Hierarchy

```
Strategy Engine  ──┐
                   ├──▶  Risk Engine  ──▶  APPROVED / REJECTED
AI Engine       ──┘         ▲
                             │
                        (veto power)
                        Cannot be overridden
```

If the Risk Engine says REJECTED, the trade does not happen.
This is not configurable. It is a hard-coded architectural guarantee.

---

## 2. Position Sizing Formula

Position sizing is **risk-based**, not fixed-dollar.

```
Risk Amount      = Account Balance × Risk Per Trade %
Stop Distance    = |Entry Price − Stop Loss Price|
Raw Size         = Risk Amount ÷ Stop Distance
Adjusted Size    = Raw Size × (1 − Fee Rate) × (1 − Slippage %)
Final Size       = min(Adjusted Size, Max Position Size)
```

### Example

```
Account Balance:    $10,000
Risk Per Trade:     1%
Risk Amount:        $100
Entry Price:        $50,000
Stop Loss:          $49,000
Stop Distance:      $1,000
Raw Size:           $100 ÷ $1,000 = 0.1 BTC
Fee Rate:           0.1%
Adjusted Size:      0.1 × 0.999 = 0.0999 BTC
```

This means: if the stop loss is hit, the maximum loss is approximately $100 (1% of account),
not a fixed dollar amount that ignores stop distance.

---

## 3. Risk Constraints Checklist

The Risk Engine evaluates every proposed trade against all of the following.
**All must pass.** One failure = REJECTED.

### 3.1 Account Constraints

| Check | Description |
|-------|-------------|
| Balance available | Account has sufficient balance for the position |
| Available margin | Margin available exceeds required margin |
| Not in emergency stop | Emergency stop is not active |
| Worker not paused | Worker is in RUNNING state |

### 3.2 Daily Loss Limits

| Check | Default | Description |
|-------|---------|-------------|
| Daily loss | 3% | Realised + unrealised loss today must not exceed this |
| Daily trade count | 5 | Maximum number of trades opened today |
| Consecutive losses | 3 | Pause if N consecutive losses (configurable) |
| Cooldown after loss | 30 min | Minimum wait after a losing trade |
| Cooldown after trade | 5 min | Minimum wait after any trade |

### 3.3 Weekly / Overall Limits

| Check | Default | Description |
|-------|---------|-------------|
| Weekly loss | 6% | Total loss this calendar week |
| Maximum drawdown | 10% | Peak-to-trough drawdown from account high |
| Maximum open positions | 3 | Number of simultaneously open positions |

### 3.4 Trade Quality Constraints

| Check | Default | Description |
|-------|---------|-------------|
| Strategy score | ≥ 80 | Composite strategy score (0–100) |
| AI confidence | ≥ 80% | AI recommendation confidence (if AI enabled) |
| Risk/reward ratio | ≥ 2.0 | Minimum reward relative to risk |
| Stop loss validity | Required | Stop loss must be set and logical |
| Take profit validity | Required | Take profit must be set and ≥ R:R minimum |
| Stop loss distance | > 0.1% | Minimum distance to prevent trivial stops |
| Position size | > minimum | Must meet exchange minimum order size |

### 3.5 Market Condition Constraints

| Check | Description |
|-------|-------------|
| Market regime | Certain strategies restricted to certain regimes |
| Volatility check | Block trades during extreme volatility spikes |
| Spread check | Block if spread exceeds configured maximum |
| Stale data check | Block if market data is older than 2× poll interval |

### 3.6 Symbol and Direction Constraints

| Check | Description |
|-------|-------------|
| Symbol whitelist | Only trade explicitly allowed symbols |
| Long enabled | Block LONG trades if longs are disabled |
| Short enabled | Block SHORT trades if shorts are disabled |
| Trading hours | Only trade within configured UTC hours |
| Existing position | Block if position in same symbol already open |

### 3.7 Leverage Constraint

| Setting | Default | Description |
|---------|---------|-------------|
| Maximum leverage | 1× | 1 = spot only (no leverage). Increase only intentionally. |

---

## 4. Daily Loss Limit Mechanics

```
Daily P&L = Σ(realised trades today) + Σ(unrealised open positions)

If Daily P&L ≤ -(Account Balance × MAX_DAILY_LOSS):
  → Block all new trades for the remainder of the calendar day (UTC)
  → Log SystemEvent: DAILY_LOSS_LIMIT_REACHED
  → Display warning on dashboard
  → Do NOT close existing positions (unless configured otherwise)
```

### Why include unrealised P&L?

Excluding unrealised losses would allow a trader to hold a deeply underwater position and
continue opening new trades up to the daily limit. Including unrealised P&L prevents
account balance deterioration beyond the configured limit.

---

## 5. Maximum Drawdown Mechanics

```
Account High Water Mark = max(equity over all time)
Current Drawdown = (High Water Mark - Current Equity) / High Water Mark

If Current Drawdown ≥ MAX_DRAWDOWN:
  → Block all new trades indefinitely (until manually reset or equity recovers)
  → Log SystemEvent: MAX_DRAWDOWN_REACHED
  → Trigger notification
```

The maximum drawdown block does not auto-reset. The user must review the situation and
explicitly reset the drawdown breaker from the dashboard.

---

## 6. Profit Target Mechanics

If a daily profit target is configured:

```
If Daily P&L ≥ DAILY_PROFIT_TARGET:
  → Stop opening new trades for the remainder of the day
  → Do NOT close existing positions
  → Log and notify

Reaching the target does NOT force any trade.
If no valid setup exists, no trade is taken regardless of whether the target was reached.
```

The profit target is a ceiling, not a mandatory objective.

---

## 7. Emergency Stop Mechanics

Triggered via dashboard or API: `POST /bot/emergency-stop`

```
Immediate effects:
  1. Worker status → EMERGENCY_STOP
  2. All new trade execution blocked
  3. Pending/unfilled orders cancelled where possible
  4. SystemEvent logged
  5. Notification sent

Existing positions:
  → Remain open (monitored but not closed automatically)
  → Unless EMERGENCY_STOP_CLOSE_POSITIONS=true (not recommended default)

To resume:
  → User must explicitly click Resume in the dashboard
  → Requires confirmation step
```

---

## 8. Trade Decision Audit Log

Every signal evaluation — whether it results in a trade or not — is written to the
`trade_decision_logs` table.

```json
{
  "id": "uuid",
  "symbol": "BTCUSDT",
  "timestamp": "2024-01-15T10:32:00Z",
  "outcome": "REJECTED",

  "strategyScore": 85,
  "requiredStrategyScore": 80,
  "strategyReasons": ["EMA bullish cross", "ADX > 25", "Volume confirmed"],

  "aiDecision": "BUY",
  "aiConfidence": 0.76,
  "requiredAIConfidence": 0.80,
  "aiReasons": ["Strong uptrend", "RSI not overbought"],

  "riskDecision": null,
  "riskRejectionReasons": [],

  "riskReward": 2.4,
  "requiredRiskReward": 2.0,

  "marketRegime": "TRENDING_UP",

  "finalReason": "AI confidence 76% below required 80%"
}
```

This ensures the user always understands **why** a trade was or was not taken.

---

## 9. Risk Settings — Dashboard Controls

All risk parameters are configurable from the dashboard without code changes.

| Setting | Type | Default | Notes |
|---------|------|---------|-------|
| Risk per trade % | float | 1% | 0.1% – 5% recommended range |
| Min risk/reward | float | 2.0 | Never go below 1.5 |
| Max daily loss % | float | 3% | Hard stop for the day |
| Max weekly loss % | float | 6% | Hard stop for the week |
| Max drawdown % | float | 10% | Requires manual reset to resume |
| Max trades per day | int | 5 | |
| Max open positions | int | 3 | |
| Max leverage | int | 1 | 1 = no leverage |
| Min strategy score | int | 80 | 0–100 |
| Min AI confidence | float | 80% | 0–100% |
| Long enabled | bool | true | |
| Short enabled | bool | false | Enable only when comfortable |
| Allowed symbols | list | [] | Empty = use exchange defaults |
| Trading hours | HH:MM–HH:MM | 00:00–23:59 UTC | |
| Cooldown after trade | minutes | 5 | |
| Cooldown after loss | minutes | 30 | |
| AI enabled | bool | true | Disable for fully rule-based mode |
| AI unavailable mode | enum | NO_TRADE | NO_TRADE or RULE_BASED |
| Paper trading | bool | true | |
| Live trading | bool | false | Requires paper validation first |

---

## 10. Important Disclaimers

- This system does not guarantee profitable trading.
- No trading strategy has guaranteed future performance.
- Backtesting results do not predict live performance.
- The Risk Engine can reject trades but cannot prevent losses on open positions.
- Always start with paper trading and validate for weeks before considering live trading.
- Never trade with money you cannot afford to lose.
- This is a personal research and engineering tool, not financial advice.
