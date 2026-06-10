# Frontend Banking Page — Implementation Guide

This document covers the `/banking` page at `localhost:3000/banking`. The page has one job: let users link a bank account and withdraw funds. It uses three backend endpoints that proxy to Bridge.xyz.

---

## Backend Endpoints

### POST `/api/bridge/external-accounts`
Create a new external bank account for a Bridge customer.

**Request body (all required unless noted):**
```json
{
  "customerId":        "bridge_customer_id",
  "firstName":         "Jane",
  "lastName":          "Smith",
  "bankName":          "Chase",
  "accountName":       "Jane's Checking",
  "routingNumber":     "021000021",
  "accountNumber":     "123456789",
  "checkingOrSavings": "checking",
  "street":            "123 Main St",
  "city":              "New York",
  "state":             "NY",
  "postalCode":        "10001",

  // optional — defaults shown
  "accountOwnerName":  "Jane Smith",
  "accountOwnerType":  "individual",
  "currency":          "usd",
  "accountType":       "us",
  "country":           "USA",
  "idempotencyKey":    "optional-uuid"
}
```

**Success response:** Bridge account object, e.g.:
```json
{
  "id":           "ea_abc123",
  "account_name": "Jane's Checking",
  "bank_name":    "Chase",
  "last_4":       "6789",
  "status":       "active"
}
```

---

### GET `/api/bridge/external-accounts/:customerId`
List all saved bank accounts for a customer.

```
GET /api/bridge/external-accounts/cust_abc123
```

**Response:**
```json
{
  "data": [
    {
      "id":           "ea_abc123",
      "account_name": "Jane's Checking",
      "bank_name":    "Chase",
      "last_4":       "6789",
      "status":       "active"
    }
  ]
}
```

---

### DELETE `/api/bridge/external-accounts/:customerId/:accountId`
Remove a linked bank account.

```
DELETE /api/bridge/external-accounts/cust_abc123/ea_abc123
```

Returns `204 No Content` or `200 {}` on success.

---

## Page Architecture

The `/banking` page has two states:

1. **Has saved accounts** — show the list, let them pick one for withdrawal, offer "Add new account"
2. **No saved accounts** — show the blank add-account form directly

```
On mount:
  GET /api/bridge/external-accounts/:customerId
    → data.length > 0  → show SavedAccounts view
    → data.length === 0 → show AddAccountForm view
```

You need the user's `customerId` (their Bridge customer ID). Store it in your auth context / local state alongside the wallet address. If you don't have a Bridge customer ID yet for the user, you'll need a separate customer-creation flow first (out of scope here — Bridge's `POST /v0/customers` endpoint).

---

## Component Tree

```
BankingPage
├── SavedAccountsList          (shown when accounts exist)
│   ├── AccountCard × N        (bank name, last 4, status)
│   │   └── [Remove] button    → DELETE endpoint
│   ├── [Withdraw from this account] button
│   └── [+ Add new account] button → toggles AddAccountForm
│
└── AddAccountForm             (shown when no accounts, or "Add new" clicked)
    ├── Personal: firstName, lastName
    ├── Bank: bankName, accountName, checkingOrSavings (select)
    ├── Account numbers: routingNumber, accountNumber
    ├── Address: street, city, state, postalCode
    └── [Save account] button → POST endpoint
```

---

## Implementation

### State

```ts
type ExternalAccount = {
  id:           string;
  account_name: string;
  bank_name:    string;
  last_4:       string;
  status:       string;
};

const [accounts,     setAccounts]     = useState<ExternalAccount[]>([]);
const [loading,      setLoading]      = useState(true);
const [showForm,     setShowForm]     = useState(false);
const [selectedId,   setSelectedId]   = useState<string | null>(null);
```

### Load existing accounts on mount

```ts
useEffect(() => {
  async function load() {
    try {
      const res  = await fetch(`/api/bridge/external-accounts/${customerId}`);
      const body = await res.json();
      setAccounts(body.data ?? []);
      setShowForm((body.data ?? []).length === 0);
    } finally {
      setLoading(false);
    }
  }
  load();
}, [customerId]);
```

### Add account form submit

```ts
async function handleAddAccount(formData: Record<string, string>) {
  const res = await fetch('/api/bridge/external-accounts', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...formData, customerId }),
  });

  if (!res.ok) {
    const err = await res.json();
    // show err.error to the user
    return;
  }

  const account = await res.json();
  setAccounts(prev => [...prev, account]);
  setShowForm(false);
}
```

### Delete account

```ts
async function handleDelete(accountId: string) {
  await fetch(`/api/bridge/external-accounts/${customerId}/${accountId}`, {
    method: 'DELETE',
  });
  setAccounts(prev => prev.filter(a => a.id !== accountId));
}
```

---

## Form Fields Reference

| Field | Input type | Notes |
|---|---|---|
| `firstName` | text | |
| `lastName` | text | |
| `bankName` | text | e.g. "Chase", "Bank of America" |
| `accountName` | text | User-facing label, e.g. "My Checking" |
| `routingNumber` | text (9 digits) | US ABA routing number |
| `accountNumber` | text | No formatting needed |
| `checkingOrSavings` | select | `"checking"` or `"savings"` |
| `street` | text | Street line 1 |
| `city` | text | |
| `state` | text | 2-letter abbrev recommended |
| `postalCode` | text | |

Optional fields (`currency`, `country`, `accountType`, `accountOwnerType`) can be hardcoded to their defaults unless you need multi-currency or business accounts.

---

## "Use Previously Stored Info" Flow

When the user has saved accounts:

1. Render each account as a card: **{bankName} ···{last4}** — `{accountName}`
2. Clicking one sets `selectedId`
3. A "Withdraw" button (disabled until one is selected) proceeds to the withdrawal step
4. "Remove" calls the DELETE endpoint and removes the card from state
5. "Add new account" sets `showForm = true` and renders `AddAccountForm` below the list

---

## Linking `customerId` to the user

Bridge requires a `customerId` for every API call. Your options:

- **Store it in Firestore** alongside the wallet address after creating the Bridge customer. Fetch it as part of the page load.
- **Use the wallet address as the key** to look up the stored `customerId` from your backend.

Example Firestore structure:
```
users/{walletAddress}/bridgeCustomerId  →  "cust_abc123"
```

If the user has no Bridge customer ID yet, redirect them to a KYC/onboarding step before showing the banking page.
