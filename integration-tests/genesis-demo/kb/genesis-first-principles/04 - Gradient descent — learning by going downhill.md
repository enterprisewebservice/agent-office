# 04 — Gradient descent — learning by going downhill

You're standing somewhere on the loss [[03 - Loss — making wrong measurable|bowl]],
blindfolded. You want the bottom. You can feel the **slope** under your feet.
The obvious move: **step in the steepest-downhill direction**, a little. Repeat.
That's gradient descent. That's the whole algorithm.

## The gradient = the uphill direction
The **gradient** is the vector of slopes — one per knob — that points in the
direction of *steepest increase* of the loss:

$$\nabla L = \left( \frac{\partial L}{\partial w},\ \frac{\partial L}{\partial b} \right)$$

- `∂L/∂w` answers: "if I nudge `w` up a hair, how much does the loss change?"
- `∂L/∂b` answers the same for `b`.

The gradient points **uphill** (toward *more* wrong). So to reduce the loss we
step the **opposite** way: downhill.

## The update rule
$$w \leftarrow w - \alpha \, \frac{\partial L}{\partial w} \qquad\qquad b \leftarrow b - \alpha \, \frac{\partial L}{\partial b}$$

```python
w -= lr * dw      # LEARN: step downhill for w
b -= lr * db      #        step downhill for b
```

- The minus sign is the entire trick: **subtract the uphill direction = move
  downhill.**
- `α` (alpha), the **learning rate** (`lr` in code, `0.05` here), is the step
  size — how far you move each time.

> [!warning] The learning rate is a Goldilocks knob
> - **Too small** → you crawl; it takes forever to reach the bottom.
> - **Too big** → you overstep the bottom, bounce up the far wall, and can
>   *diverge* — the loss explodes to infinity instead of shrinking.
> - **Just right** → steady, quick descent. Picking it is a craft; `0.05` works
>   for this bowl. It's a [[01 - A model is a function with adjustable beliefs|hyperparameter]], not learned.

## Why it's guaranteed to work here
For MSE + a linear model the bowl is **convex** — a single global minimum, no
local dips to get trapped in. So small downhill steps *must* eventually reach
the bottom. (In deep networks the landscape is lumpy and this guarantee weakens,
which is why training big models is fiddlier — but the *move* is identical.)

But where do `∂L/∂w` and `∂L/∂b` actually come from? We derive them by hand —
no autograd, no magic. → [[05 - Deriving the gradients by hand]]
