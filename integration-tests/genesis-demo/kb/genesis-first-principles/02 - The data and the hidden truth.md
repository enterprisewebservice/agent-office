# 02 — The data and the hidden truth

## A universe with a rule
We invent a tiny universe whose law we secretly know:

$$y = \underbrace{2}_{w^\*} \cdot x + \underbrace{1}_{b^\*} + \varepsilon, \qquad \varepsilon \sim \mathcal{N}(0,\, 0.5^2)$$

- `w* = 2`, `b* = 1` are the **true** parameters — the law of this universe.
- `ε` (epsilon) is **noise**: a small random wobble drawn from a Gaussian, so no
  point sits exactly on the line. Real data is always noisy.

In code (`generate_data`):
```python
x = rng.uniform(-3.0, 3.0, size=n)            # inputs
y = true_w * x + true_b + rng.normal(0, noise, size=n)   # outputs, with wobble
```

> [!important] The model never sees the truth
> The training code is handed only the pairs `(x, y)`. It is **never** told
> `w* = 2` or `b* = 1`. Its whole job is to *recover* that rule from the noisy
> examples. That recovery is what "learning" means here, made concrete.

## Why a *known* truth (when real life never gives you one)
In the real world you never know the underlying rule — that's why you built a
model in the first place. But for *learning to learn*, a known truth is gold:
it turns the vague question "did it work?" into the exact question "did `w` land
near 2 and `b` near 1?" We can grade the model objectively. → [[07 - Did it actually learn]]

## Train / test split
We cut the data into two piles:
```python
cut = int(n * 0.8)
train = (x[:cut],  y[:cut])     # 80% — the model learns from these
test  = (x[cut:],  y[cut:])     # 20% — held back, never seen during training
```

The **test set** is the honesty check. A model could get a perfect score on the
training points by *memorizing* them. The only way to score well on points it
has **never seen** is to have captured the actual *pattern*. Memorization vs.
generalization is the whole game — see [[07 - Did it actually learn]].

> [!tip] Intuition
> Studying for an exam by memorizing last year's answer key (the train set) vs.
> understanding the subject. The held-out test set is this year's exam.

Next: to improve the knobs, we first need to measure how wrong they are.
→ [[03 - Loss — making wrong measurable]]
