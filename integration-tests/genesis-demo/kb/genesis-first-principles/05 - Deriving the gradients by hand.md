# 05 — Deriving the gradients by hand

This is the one place people let a library do the thinking. We won't. The two
gradients in the code come from ordinary calculus — the chain rule, applied to
one term, then averaged.

## The setup
The loss for the whole training set:

$$L = \frac{1}{n} \sum_{i=1}^{n}\big(\underbrace{w x_i + b - y_i}_{e_i}\big)^2$$

We want `∂L/∂w` and `∂L/∂b`. Because the derivative of a sum is the sum of
derivatives, we can work on **one term** `eᵢ²` and average at the end.

## Slope with respect to w
Apply the chain rule to `eᵢ² = (w xᵢ + b − yᵢ)²` — outer power, then inner:

$$\frac{\partial}{\partial w} e_i^2 = 2 e_i \cdot \frac{\partial e_i}{\partial w} = 2 e_i \cdot x_i$$

(because `∂eᵢ/∂w = ∂(w xᵢ + b − yᵢ)/∂w = xᵢ`). Average over all examples:

$$\boxed{\ \frac{\partial L}{\partial w} = \frac{2}{n}\sum_{i=1}^{n} e_i\, x_i\ }$$

```python
dw = float(2 * (err * x).mean())     # GRADIENT: downhill direction for w
```
`(err * x).mean()` is exactly `(1/n) Σ eᵢ xᵢ`; the `2` is the constant out front. ✔

## Slope with respect to b
Same move, but `∂eᵢ/∂b = 1`:

$$\frac{\partial}{\partial b} e_i^2 = 2 e_i \cdot \frac{\partial e_i}{\partial b} = 2 e_i \cdot 1$$

$$\boxed{\ \frac{\partial L}{\partial b} = \frac{2}{n}\sum_{i=1}^{n} e_i\ }$$

```python
db = float(2 * err.mean())           # GRADIENT: downhill direction for b
```
`err.mean()` is `(1/n) Σ eᵢ`. ✔

## Read the gradients as instructions
They're not just symbols — each says *what to do*:
- `∂L/∂w = (2/n) Σ eᵢxᵢ`: errors weighted by their input. A point with large `x`
  that we got wrong has a big say in how the **slope** should move — sensible,
  since slope errors blow up far from the origin.
- `∂L/∂b = (2/n) Σ eᵢ`: just the **average error**. If we're predicting too high
  on average (`Σeᵢ > 0`), `∂L/∂b` is positive, so the update `b -= lr·∂L/∂b`
  pushes `b` **down**. Exactly right.

> [!note] This is "backpropagation," in miniature
> Working the chain rule from the loss back to each parameter *is*
> backprop. In a deep net you chain it through many layers; here there's one
> layer, so it's a single step. Same rule, less of it. → [[08 - This is all deep learning is]]

Now we have every piece. Let's watch them run together. → [[06 - The training loop, line by line]]
