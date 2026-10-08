import assert from "node:assert/strict";
import type { APIRequestContext, Page } from "playwright";

// Only used against isolated verification data. Do not add a production captcha bypass.
export function captchaText(image: string) {
  const svg = Buffer.from(image.split(",")[1], "base64").toString();
  return [...svg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/g)]
    .map((match) => match[1])
    .join("");
}
export async function fillCaptcha(page: Page) {
  const image = page.getByRole("img", { name: "图片验证码", exact: true });
  await image.waitFor();
  await page
    .getByLabel("验证码", { exact: true })
    .fill(captchaText((await image.getAttribute("src")) || ""));
}
export async function apiLogin(
  request: APIRequestContext,
  base: string,
  username: string,
  password: string,
  setup = false,
) {
  const challenge = await request.get(`${base}/api/auth/captcha`);
  assert(challenge.ok());
  const captcha = captchaText((await challenge.json()).image);
  const response = await request.post(
    `${base}/api/auth/${setup ? "setup" : "login"}`,
    {
      data: {
        username,
        password,
        captcha,
        ...(setup ? { displayName: "回归管理员" } : {}),
      },
      headers: { "X-Studio-Request": "1" },
    },
  );
  assert(response.ok(), await response.text());
  return response.json();
}
