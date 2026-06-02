# 09 — Glossary

One-line definitions, each linked to where it's built up.

- **Model** — a function with adjustable numbers that maps inputs to predictions.
  Here `ŷ = w·x + b`. → [[01 - A model is a function with adjustable beliefs]]
- **Parameter** — a number the model *learns* (`w`, `b`). The knowledge lives
  here. → [[01 - A model is a function with adjustable beliefs]]
- **Hyperparameter** — a number *you* set that governs how learning happens
  (learning rate, epochs). Not learned. → [[04 - Gradient descent — learning by going downhill]]
- **Weight (`w`)** — parameter multiplying an input; the model's belief about
  slope/importance. → [[01 - A model is a function with adjustable beliefs]]
- **Bias (`b`)** — additive parameter; the model's belief about the baseline
  output when inputs are 0. → [[01 - A model is a function with adjustable beliefs]]
- **Prediction (`ŷ`)** — the model's output for an input, given current params.
- **Ground truth (`y`)** — the actual observed output for an example.
- **Noise (`ε`)** — random wobble in the data; why points don't sit exactly on
  the line. → [[02 - The data and the hidden truth]]
- **Train / test split** — partition the data; learn on train, judge on
  held-out test. → [[02 - The data and the hidden truth]]
- **Loss** — one number measuring how wrong the model is now; lower is better.
  → [[03 - Loss — making wrong measurable]]
- **MSE (Mean Squared Error)** — the loss we use: average of squared errors.
  → [[03 - Loss — making wrong measurable]]
- **Loss landscape / bowl** — the loss as a surface over all parameter settings;
  training descends it. → [[03 - Loss — making wrong measurable]]
- **Gradient (`∇L`)** — vector of slopes of the loss w.r.t. each parameter;
  points uphill. → [[04 - Gradient descent — learning by going downhill]]
- **Gradient descent** — repeatedly step parameters *opposite* the gradient to
  reduce loss. → [[04 - Gradient descent — learning by going downhill]]
- **Learning rate (`α` / `lr`)** — step size per update. Too big diverges, too
  small crawls. → [[04 - Gradient descent — learning by going downhill]]
- **Epoch** — one full pass over the training data. → [[06 - The training loop, line by line]]
- **Backpropagation** — computing the gradient by the chain rule from loss back
  to each parameter. Here it's one step; in deep nets, many. → [[05 - Deriving the gradients by hand]]
- **Convergence** — parameters stop moving meaningfully because the slope is
  ~flat; you've reached the bottom. → [[06 - The training loop, line by line]]
- **Generalization** — low error on *unseen* data; evidence the pattern was
  learned, not memorized. → [[07 - Did it actually learn]]
- **Overfitting** — low train error, high test error; fit the noise, not the
  signal. → [[07 - Did it actually learn]]
- **Underfitting** — high error on both; too simple or trained too little.
  → [[07 - Did it actually learn]]
- **Nonlinearity** — a bend (e.g. ReLU) between layers so stacked linear pieces
  don't collapse into one line. → [[08 - This is all deep learning is]]

→ Back to [[Genesis — First Principles of a Predictive Model|the index]]
