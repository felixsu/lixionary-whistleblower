# Bundled design-system fonts

Unmodified Latin WOFF2 subsets copied from `@fontsource/inter`,
`@fontsource/cormorant-garamond` and `@fontsource/jetbrains-mono` version 5.3.0
in the IAM frontend. Each family retains its SIL Open Font License in this
folder. `app/layout.tsx` serves the files with `next/font/local`; no browser
requests go to Google Fonts or a font CDN.

Inter supplies weights 400, 500 and 600; Cormorant Garamond and JetBrains Mono
supply weight 400. System fallbacks cover characters outside these subsets.

Google Sans Medium is bundled only for the Google sign-in button. Its unmodified
Latin WOFF2 subset comes from Google Fonts
(`https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&display=swap`),
with its SIL Open Font License in `google-sans-OFL.txt`. It is served locally
through `next/font/local`, without browser requests to a font CDN.
