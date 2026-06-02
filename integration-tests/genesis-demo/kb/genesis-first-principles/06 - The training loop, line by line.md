# 06 — The training loop, line by line

Everything so far collapses into one short loop. This is the `train_gd`
component of `pipeline.py`, whole:

```python
w, b = 0.0, 0.0                       # 1. start ignorant
for epoch in range(epochs):           # 2. repeat many times
    yhat = w * x + b                  # 3. PREDICT   (note 01)
    err  = yhat - y                   # 4. how wrong (note 03)
    loss = float((err ** 2).mean())   # 5. LOSS = one number (note 03)
    dw = float(2 * (err * x).mean())  # 6. GRADIENT for w (note 05)
    db = float(2 * err.mean())        # 7. GRADIENT for b (note 05)
    w -= lr * dw                      # 8. LEARN: step downhill (note 04)
    b -= lr * db
```

## The five beats, every epoch
1. **Predict** with current beliefs → `yhat`.
2. **Compare** to truth → `err`.
3. **Score** the wrongness → `loss` (we only *log* this; the step uses the
   gradients).
4. **Find downhill** for each knob → `dw`, `db`.
5. **Step** the knobs a little downhill → new `w`, `b`.

Then do it again with the slightly-better knobs. Each pass over the data is one
**epoch** (here, 300 of them).

> [!important] Vectorized, but not magic
> `x`, `y`, `err` are whole arrays (numpy), so `w * x + b` predicts on *all*
> training points at once and `.mean()` averages over them. The loop is over
> *epochs* (passes), **not** over examples. The math is identical to doing each
> point by hand — just faster.

## What you'd watch it print
```
epoch    0  loss=14.91  w=0.62  b=0.10
epoch   45  loss=0.94   w=1.71  b=0.74
epoch  120  loss=0.27   w=1.95  b=0.96
epoch  299  loss=0.25   w=1.99  b=1.00
```
`w` climbs 0 → ~2, `b` climbs 0 → ~1, and the loss falls and **flattens**. The
flattening is the bowl's bottom: the gradients shrink toward 0 as you approach
the minimum, so the steps get smaller on their own. The model has converged.

> [!note] "Convergence" demystified
> It just means the knobs stopped moving meaningfully because the slope under
> them is ~flat. There's nowhere better to go. Knowledge now lives in
> `w ≈ 2, b ≈ 1`.

The numbers *look* learned. But did it learn the **pattern**, or just fit these
points? → [[07 - Did it actually learn]]
