// The fixed list both rules and the model must use.
export const CATEGORIES = [
  "Groceries",
  "Eating out",
  "Transport",
  "Fuel",
  "Housing",
  "Utilities",
  "Insurance",
  "Health",
  "Shopping",
  "Entertainment",
  "Subscriptions",
  "Travel",
  "Education",
  "Gifts and donations",
  "Fees and interest",
  "Income",
  "Transfers",
  "Investments", // money put into investing platforms: saved, not spent
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];
