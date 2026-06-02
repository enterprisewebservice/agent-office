# 03 — Loss — making "wrong" measurable

To improve, the model needs a single number that says **how wrong it currently
is**. Lower = better. That number is the **loss**.

## Error, per example
For one example, the error is just prediction minus truth:

$$e_i = \hat{y}_i - y_i = (w x_i + b) - y_i$$

```python
err = yhat - y        # how wrong, per example (a whole vector at once)
```

A positive `eᵢ` means we predicted too high; negative, too low.

## Mean Squared Error (MSE)
We can't just add the errors — positives and negatives would cancel and a
terrible model could look perfect. So we **square** each error (killing the
sign, and punishing big misses far more than small ones) and take the average:

$$L(w, b) = \frac{1}{n} \sum_{i=1}^{n} e_i^2 = \frac{1}{n} \sum_{i=1}^{n}\big(w x_i + b - y_i\big)^2$$

```python
loss = float((err ** 2).mean())     # MSE: one number to push down
```

> [!note] Why squared, specifically?
> 1. **Sign doesn't cancel** — every error contributes positively.
> 2. **Big errors dominate** — being off by 4 costs 16, being off by 1 costs 1;
>    the model is pushed hardest to fix its worst predictions.
> 3. **It's smooth** — squaring gives a gently curved bowl with a single lowest
>    point and no kinks, so "which way is downhill" is always well-defined. That
>    smoothness is what makes [[04 - Gradient descent — learning by going downhill|gradient descent]] possible.

## The loss is a landscape
Here is the key mental picture. The data is *fixed*. So the loss `L` is a
function of the **knobs** `w` and `b` only. Picture a 3-D surface: the floor is
every possible `(w, b)` setting, the height above each point is how wrong that
setting is.

- That surface is a **bowl** (for MSE + a linear model it's a perfect
  paraboloid — one global minimum, no false bottoms to get stuck in).
- The lowest point of the bowl is the best `(w, b)` — for our universe, near
  `(2, 1)`.
- Training = **finding your way to the bottom of the bowl** while blindfolded,
  knowing only the slope under your feet.

How do you find the bottom of a bowl you can't see, using only the slope?
→ [[04 - Gradient descent — learning by going downhill]]
