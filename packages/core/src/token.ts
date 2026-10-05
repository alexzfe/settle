// No 0/O or 1/l/I, so a token read off a screen can't be mistyped; 24 of them is about 139 bits.
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 24;

/**
 * An unguessable token: a Quick Guide's on its phone page, a Home's for its Agent. `random` gives
 * an integer from 0 up to, not including, its argument.
 */
export function randomToken(random: (max: number) => number): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[random(TOKEN_ALPHABET.length)];
  }
  return token;
}
