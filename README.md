# LawSchoolExamPrep

A phone-first study app for law school exams. You load your own outline (PDF or Word), pick a topic, and practice with quick multiple-choice rounds, timed essay prompts, or a mix of both. It works offline and keeps your progress on your phone.

## Put it on your iPhone

1. In this repo on GitHub, go to **Settings → Pages**. Under "Build and deployment," set **Source** to *Deploy from a branch*, pick **main** and **/ (root)**, then click **Save**.
2. After a minute or two, the site is live at `https://tbilkitty.github.io/LawSchoolExamPrep/`.
3. Open that address in **Safari** on your iPhone.
4. Tap **Share**, then **Add to Home Screen**. The app opens full-screen and works offline after the first visit.

## Where questions come from

| Source | Needs | What you get |
|---|---|---|
| **Your outline** (always on) | Nothing; it runs on the phone | Fill-in-the-blank questions built from your outline's own sentences. Wrong answers are other terms, cites and figures from the same outline. Each explanation quotes your outline and gives the heading and page. Sections too thin for a fair question are skipped, and the app tells you why. Written practice is a rule drill checked against your outline's key terms. |
| **Quiz packs** (.json or .csv) | A file | Questions with practice hypotheticals, explanations for every wrong answer, and essay prompts with model answers. Two starter packs are built in. Use `packs/template.json` or `packs/template.csv` to write your own, or ask Claude to write one from your outline. |
| **AI mode** (optional) | Your own Anthropic API key, entered in Settings | Practice hypotheticals written from your outline, and graded essay feedback (Issue, Rule, Application, Conclusion). The key is stored only in your phone's browser and is never part of this repo. API use is billed to your Anthropic account. |

Writing new hypotheticals and grading essays takes an AI model. Without AI mode, the app sticks to what it can do reliably on the phone: questions built from your outline's sentences, packs you load, and self-check essay feedback.

## Features

- Sessions: Quick MC (5, 10 or 15 questions), Essay (1–3 prompts, optional 5/10/15-minute timer), or Mixed.
- Pause, resume or end a session at any time; it's saved automatically.
- Correct answers: about one second of falling gold coins and bills, plus a coin chime. Wrong answers: a cartoon ink splat, then a calm explanation.
- Settings: sound, wrong-answer sound (off by default), animations, reduced motion, text size.
- Read aloud for questions and explanations.
- Flag, Save and Review again lists. Missed questions are added to Review again automatically.
- Accuracy by topic and an end-of-session summary with a suggested next step.
- Backup and restore your data as a file.

## Files

- `index.html`, `styles.css`: layout and look
- `js/app.js`: screens, sessions and storage
- `js/parse.js`: reads PDF (with bundled pdf.js), DOCX (no library) and TXT outlines and finds headings
- `js/gen.js`: builds questions from outline sentences
- `js/fx.js`: effects, sounds (generated in the browser, no audio files) and read aloud
- `js/ai.js`: optional AI mode
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and the Home Screen icon
- `packs/`: starter packs and templates
- `vendor/pdfjs/`: Mozilla pdf.js, Apache License 2.0

## Limits

- Scanned PDFs (images of pages) have no text to read.
- Old `.doc` files need to be saved as `.docx`.
- Heading detection uses Word heading styles, or larger or numbered lines in PDFs. Outlines with unusual formatting may come in as fewer topics.
- Starter packs are based on the Code and Treasury Regulations, not on any particular course's materials.

## Partnership Tax Calculator

A separate home-screen app lives in `partnership-calculator/`: yes/no questions for outside and inside basis, capital accounts, and recourse and nonrecourse liabilities, with each step and its Code or Regulation cite. Open `https://tbilkitty.github.io/LawSchoolExamPrep/partnership-calculator/` on your phone and use **Add to Home Screen**. It works offline after the first visit.
