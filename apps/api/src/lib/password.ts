import { config } from "../config";

// Bun ships a native bcrypt implementation, so no extra dependency is needed.
export const hashPassword = (password: string) =>
  Bun.password.hash(password, { algorithm: "bcrypt", cost: config.BCRYPT_COST });

export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash);

// Verified against when the email is unknown, so "no such user" and "wrong password"
// take roughly the same time and can't be told apart by timing.
let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password"));
