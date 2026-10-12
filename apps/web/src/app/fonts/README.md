# Bundled design-system fonts

Unmodified Latin WOFF2 subsets copied from `@fontsource/inter`,
`@fontsource/cormorant-garamond` and `@fontsource/jetbrains-mono` version 5.3.0
in the IAM frontend. Each family retains its SIL Open Font License in this
folder. `app/layout.tsx` serves the files with `next/font/local`; no browser
requests go to Google Fonts or a font CDN.

Inter supplies weights 400, 500 and 600; Cormorant Garamond and JetBrains Mono
supply weight 400. System fallbacks cover characters outside these subsets.
