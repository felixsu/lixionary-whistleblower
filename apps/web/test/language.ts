import type { Page } from "@playwright/test";

export async function selectLanguage(page: Page, language: "en" | "id") {
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page
    .getByRole("option", {
      name: language === "id" ? "Bahasa Indonesia" : "English",
      exact: true,
    })
    .click();
}
