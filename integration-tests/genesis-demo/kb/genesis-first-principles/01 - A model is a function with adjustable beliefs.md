# 01 — A model is a function with adjustable beliefs

## The function
Our model is one line of arithmetic:

$$\hat{y} = w \cdot x + b$$

- `x` is the **input** (what we know).
- `ŷ` ("y-hat") is the model's **prediction** (what it guesses).
- `w` (**weight**) and `b` (**bias**) are the **parameters** — the adjustable
  numbers. They are the *entire* model. Change them and you have a different
  model; nothing else about the function changes.

In code (`pipeline.py`, the `train_gd` component) this is literally:
```python
yhat = w * x + b          # PREDICT: apply current belief
```

## "Belief" is not a metaphor
`w` is the model's belief about **slope**: "when `x` goes up by 1, `y` goes up
by `w`." `b` is its belief about the **baseline**: "when `x` is 0, `y` is `b`."

A model that has learned nothing starts with `w = 0, b = 0` — it believes the
answer is always 0, regardless of input. That is *maximal ignorance*, and it's
exactly where we start training. Learning = moving those beliefs toward ones
that fit the evidence.

> [!note] Why this is the honest atom of ML
> Bigger models swap this one line for billions of `w`'s arranged in layers,
> with a squiggle (a *nonlinearity*) between them so they can bend, not just go
> straight. But every one of those billions of numbers is the same *kind* of
> thing as our `w`: an adjustable belief, moved by the same procedure. See
> [[08 - This is all deep learning is]].

## Parameters vs. hyperparameters
- **Parameters** (`w`, `b`): the model *learns* these. They start ignorant.
- **Hyperparameters** (the learning rate `lr`, the number of `epochs`): *you*
  choose these; they govern *how* learning happens, not *what* is learned. More
  in [[04 - Gradient descent — learning by going downhill]].

Next: where do the examples come from, and what is the model trying to recover?
→ [[02 - The data and the hidden truth]]
