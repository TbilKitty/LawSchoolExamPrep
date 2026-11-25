# LawSchoolExamPrep

A phone-first study app for law school exams. You load your own outline (PDF or Word), pick a topic, and practice with quick multiple-choice rounds, timed essay prompts, or a mix of both. It works offline and keeps your progress on your phone.

## Put it on your iPhone

1. In this repo on GitHub, go to **Settings → Pages**. Under "Build and deployment," set **Source** to *Deploy from a branch*, pick **main** and **/ (root)**, then click **Save**.
2. After a minute or two, the site is live at `https://tbilkitty.github.io/LawSchoolExamPrep/`.
3. Open that address in **Safari** on your iPhone.
4. Tap **Share**, then **Add to Home Screen**. The app opens full-screen and works offline after the first visit.

## Memory Bank

Tap **Add to Memory Bank**, pick a PDF, Word (.docx), Markdown or text outline, or a question bank (.json or .csv with an answer key). Choose the course, edit the title, and tap **Save to Memory Bank**. The app keeps the original file and its readable text on the phone (IndexedDB), grouped by course (Partnership Tax, Business Organizations, Bar Prep, or a new one). Open any saved item to read its text, open the original file, rename it, move it, replace the file, or delete it.

## Practice

| Mode | Needs | What you get |
|---|---|---|
| **Basis Math** | Nothing; works offline | Partnership tax calculations with fresh numbers, one-step problems first, then multistep: initial outside basis, inside basis (§ 723), debt share up and down, year-end basis, the § 704(d) loss limit, distributions over basis, and outside basis vs. inside basis vs. § 704(b) book capital vs. tax capital. The math is shown line by line. Every problem is checked before it appears: the steps must equal the answer and there must be exactly one correct choice. **Try With New Numbers** keeps the rule and swaps the figures. |
| **Multiple Choice** | AI mode (your Anthropic API key) | Fact-pattern questions written from your saved outlines. Four choices, one best answer, and an explanation attached to every choice. Questions are dropped if a choice is only a citation, a dollar answer's arithmetic doesn't check out, or anything cites a statute or regulation that isn't in your outline. |
| **Short Essay** | AI mode | A short fact pattern, then a model answer and a scoring checklist after you submit or tap **Reveal Answer**. With AI mode on, your written answer is graded too. |
| **Mixed Practice** | AI mode | Multiple choice plus a short essay, with Basis Math added for Partnership Tax. |
| **Practice Existing Questions** | A question bank | Your bank's questions with its own answer key. |

**Show the Four Accounts** (Partnership Tax questions): stacked cards for outside basis, inside basis, § 704(b) book capital and tax basis capital: whose number it is, what it tracks, and a worked example (Maya contributes land: $30k basis, $50k FMV) plus a debt example where outside basis and tax capital split apart. "Which account is it?" questions reveal all four of the question's numbers after you answer.

Math steps are colored by operation everywhere: additions green (+$21k), subtractions red (−$9k), with the running balance on each row.

**Work the Math** (optional, on Basis Math questions): the starting balance if the question gives one, then each dollar amount with large **+ Add**, **− Subtract** and **Skip** buttons (and **Use the Smaller Amount** for capped questions like the § 704(d) loss limit). Tap in any order; change a step, undo or reset; the running total updates as you go without saying whether you're right. After you answer, **My Calculation** and **Correct Calculation** appear side by side with the first step where they differ and why the rule adds, subtracts or leaves that amount out.

**Alt Lesson** (beside **Start Practice** on a course): alternate lessons are configured per course in `ALT_LESSONS` in `js/app.js`, and the button appears only for courses listed there. Partnership Tax has **Open-Book Sprint**: one short fact pattern in about five minutes (optional timer), in three steps:
1. **Spot the Issue**: pick what the question tests (your first pick is saved), search your saved Partnership Tax outline, revise, submit. You then see the matching heading from your outline, a search phrase, and a button that opens that section.
2. **Work the Math**: the Work the Math panel; after you submit, My Calculation vs Correct Calculation, the first step that changed the result, and which of the four balances changed or stayed the same.
3. **Write the Exam Sentence**: type or dictate one sentence; a model sentence and a three-item checklist follow.

Afterward, **Change One Fact** reruns the same scenario with one fact flipped (you predict which balance moves first), and **Redo My Mistake** saves each decision you missed and later gives you a fresh problem on that same decision (also under Review).

**Quick 5** on the home screen starts five questions from the course you used last. Every generated set is saved under **Saved sets** to replay or review with all answers, offline. Leaving mid-set saves your place.

After every multiple-choice answer you see the correct choice in full, why it's right, why your choice was wrong and when that reasoning would work, the rule in plain English, the fact that triggers it, the math or application, and the reference underneath. The other choices' explanations are under **Why the other choices are wrong**. A **Next Question** button sits under the explanation and stays in the bottom bar while you scroll.

## Files

- `index.html`, `styles.css`: layout and look
- `js/app.js`: screens, sessions and storage
- `js/parse.js`: reads PDF (with bundled pdf.js), DOCX (no library) and TXT outlines and finds headings
- `js/gen.js`: outline text helpers (key-term check for essays)
- `js/fx.js`: effects, sounds (generated in the browser, no audio files) and read aloud
- `js/ai.js`: AI mode and the checks applied to everything it writes
- `js/math.js`: Basis Math problems and their checks
- `js/sprint.js`: Open-Book Sprint scenarios, outline matching and search
- `js/db.js`: Memory Bank storage on the phone (IndexedDB)
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and the Home Screen icon
- `packs/`: starter packs and templates
- `vendor/pdfjs/`: Mozilla pdf.js, Apache License 2.0

## Limits

- Scanned PDFs (images of pages) have no text to read.
- Old `.doc` files need to be saved as `.docx`.
- Heading detection uses Word heading styles, or larger or numbered lines in PDFs. Outlines with unusual formatting may come in as fewer topics.
- Starter packs are based on the Code and Treasury Regulations, not on any particular course's materials.
