# Genesis — First Principles of a Predictive Model

> [!abstract] The one idea
> A predictive model is just a **function with adjustable numbers**. "Learning"
> is the mechanical process of **nudging those numbers** until the function's
> predictions stop being wrong. There is nothing else under the hood — not in
> this tiny model, not in a 400-billion-parameter LLM. Only *more numbers* and
> *more nudges*.

This vault teaches that idea from the ground up, using the smallest honest
example: a straight line, `ŷ = w·x + b`, learning to recover a known truth
(`y = 2x + 1`) from noisy data — by hand-written gradient descent, no
`sklearn.fit` hiding the one thing worth understanding.

Every note maps to a real, runnable artifact: [[10 - Run it yourself|the actual KFP pipeline]] (`pipeline/pipeline.py`) that the Genesis agents run on OpenShift
AI. The math in these notes *is* the code in that file.

## Read in order
1. [[00 - Start here]] — what you'll be able to do by the end
2. [[01 - A model is a function with adjustable beliefs]]
3. [[02 - The data and the hidden truth]]
4. [[03 - Loss — making wrong measurable]]
5. [[04 - Gradient descent — learning by going downhill]]
6. [[05 - Deriving the gradients by hand]]
7. [[06 - The training loop, line by line]]
8. [[07 - Did it actually learn]]
9. [[08 - This is all deep learning is]]
10. [[10 - Run it yourself]] — watch it learn in the OpenShift AI Experiments UI

Reference: [[09 - Glossary]]

## How to open this in Obsidian
This folder *is* an Obsidian vault. Open Obsidian → **Open folder as vault** →
pick this directory. Turn on the **graph view** (the icon in the left ribbon) to
see how the ideas connect. The math renders as LaTeX; the `[[links]]` are
clickable.

> [!tip] Why a straight line?
> Because you can hold the entire thing in your head. Once `w` and `b` and
> "downhill" are obvious here, scaling to millions of parameters changes the
> arithmetic's *size*, not its *nature*. Start where you can see the whole board.
