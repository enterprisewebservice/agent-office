# 07 — Did it actually learn?

A low training loss is **not** proof of learning — a model can score well on the
points it trained on by memorizing them. The `evaluate` component asks two
sharper questions.

## Question 1 — Generalization (the honest test)
Run the trained `w, b` on the **held-out test set** — points the model never saw
during training — and measure the error there:

$$\text{test MSE} = \frac{1}{m}\sum_{j \in \text{test}} (w x_j + b - y_j)^2$$

```python
test_mse = float(((w * x + b - y) ** 2).mean())   # on TEST data
```

Low test error means the model captured the *pattern*, not the specific points.
This is the number that matters in the real world, where you never know the
underlying truth — the test set is your only honest judge.

## Question 2 — Recovery (only the demo can check this)
Because *we* planted the truth (`w* = 2`, `b* = 1`), we can also ask: did the
knobs land near it?

```python
w_err = abs(w - true_w)     # |learned slope  − 2|
b_err = abs(b - true_b)     # |learned bias   − 1|
learned_ok = 1.0 if (w_err < 0.25 and b_err < 0.25) else 0.0
```

`learned_ok` is the single pass/fail flag the [[10 - Run it yourself|integration test]] and the worker agent read. Green means: *the model recovered the law of
its universe from noisy data.* That's learning, proven.

## The two ways it can fail (and what they look like)
> [!warning] Underfitting vs. overfitting
> - **Underfitting** — high error on *both* train and test. The model is too
>   simple, or trained too little (too few epochs / `lr` too small). It never
>   reached the bottom of the bowl. *Fix:* train longer, bigger model.
> - **Overfitting** — low train error but *high test* error. The model bent
>   itself to the training points' noise instead of the signal. *Fix:* more
>   data, simpler model, regularization.
>
> Our straight line on clean-ish linear data lands in the sweet spot: low train
> **and** low test error, knobs on the truth.

## Why the test split was non-negotiable
Without it, "it learned!" would just mean "it memorized the answer key." The
held-out split is what lets you tell the difference — the single most important
discipline in all of machine learning, visible here in 20 saved data points.

So that's the whole thing. Now the surprise: → [[08 - This is all deep learning is]]
