"""Genesis Model — the smallest honest predictive model, from first principles.

A linear model  ŷ = w·x + b  trained by HAND-WRITTEN gradient descent (no
sklearn.fit — that would hide the one thing we want to understand). The data
has a KNOWN truth, y = TRUE_W·x + TRUE_B + noise, so "learning" is concrete:
we watch w crawl from 0 toward TRUE_W and the loss fall. The model recovers
the law of its little universe from noisy examples — that's all of ML, once.

Three KFP v2 lightweight components (the from-scratch code lives right here,
readable top-to-bottom; runs in a stock python image with numpy — no custom
image build):
    generate_data  ->  train_gd  ->  evaluate

Run on the agent-office DSPA (OpenShift AI). Each component emits kfp Metrics,
so the loss + the recovered parameters show up as sortable columns in the
Experiments/Runs UI — the model learning, visibly and reproducibly.

Compile:
    pip install kfp
    python pipeline.py        # writes pipeline.yaml next to this file
"""

from kfp import compiler, dsl

BASE_IMAGE = "registry.access.redhat.com/ubi9/python-311:latest"


@dsl.component(base_image=BASE_IMAGE, packages_to_install=["numpy==2.1.3"])
def generate_data(
    n: int,
    true_w: float,
    true_b: float,
    noise: float,
    seed: int,
    train: dsl.Output[dsl.Dataset],
    test: dsl.Output[dsl.Dataset],
):
    """The universe. y = true_w*x + true_b + Gaussian noise. We hold out a
    test split so 'did it learn?' means 'does it predict UNSEEN points?',
    not 'did it memorize?'. The model never sees true_w/true_b — only (x, y)."""
    import json
    import numpy as np

    rng = np.random.default_rng(seed)
    x = rng.uniform(-3.0, 3.0, size=n)
    y = true_w * x + true_b + rng.normal(0.0, noise, size=n)
    cut = int(n * 0.8)
    with open(train.path, "w") as f:
        json.dump({"x": x[:cut].tolist(), "y": y[:cut].tolist()}, f)
    with open(test.path, "w") as f:
        json.dump({"x": x[cut:].tolist(), "y": y[cut:].tolist()}, f)
    print(f"generated {n} points, y = {true_w}*x + {true_b} + N(0,{noise}); "
          f"{cut} train / {n - cut} test")


@dsl.component(base_image=BASE_IMAGE, packages_to_install=["numpy==2.1.3", "mlflow-skinny==3.6.0"])
def train_gd(
    train: dsl.Input[dsl.Dataset],
    epochs: int,
    lr: float,
    model: dsl.Output[dsl.Model],
    metrics: dsl.Output[dsl.Metrics],
    mlflow_uri: str = "",
    mlflow_workspace: str = "agent-office",
    mlflow_experiment: str = "genesis-model",
):
    """The whole of machine learning, once, by hand.

    Start ignorant (w=0, b=0). Repeat: predict, measure how wrong, work out
    which way is downhill for each parameter, take a small step that way.
    That's gradient descent. There is nothing else under the hood of the
    giant models — only more parameters and more steps."""
    import json
    import os
    import numpy as np

    # --- optional MLflow tracking: stream the loss curve to the OpenShift AI
    # MLflow tracking server. Auth is the documented RHOAI way: the pod's
    # ServiceAccount token (-> Authorization: Bearer) + the workspace=namespace
    # header (X-MLFLOW-WORKSPACE, sent by the client from MLFLOW_WORKSPACE).
    # The pipeline SA needs the mlflow-operator-mlflow-view/-edit roles bound in
    # the workspace namespace. If mlflow_uri is empty, tracking is skipped. ---
    USE_MLFLOW = bool(mlflow_uri)
    if USE_MLFLOW:
        try:
            os.environ["MLFLOW_TRACKING_INSECURE_TLS"] = "true"   # internal CA on :8443
            _tok = "/var/run/secrets/kubernetes.io/serviceaccount/token"
            if os.path.exists(_tok):
                os.environ["MLFLOW_TRACKING_TOKEN"] = open(_tok).read().strip()  # -> Authorization: Bearer
            import mlflow
            # RHOAI MLflow is multi-tenant: every REST call must carry the
            # workspace=namespace header. The released client has no
            # mlflow.set_workspace(), so register a request-header provider that
            # injects X-MLFLOW-WORKSPACE on every call (the documented plugin hook).
            from mlflow.tracking.request_header.abstract_request_header_provider import RequestHeaderProvider
            from mlflow.tracking.request_header.registry import _request_header_provider_registry
            class _WorkspaceHeader(RequestHeaderProvider):
                def in_context(self):
                    return True
                def request_headers(self):
                    return {"X-MLFLOW-WORKSPACE": mlflow_workspace}
            _request_header_provider_registry.register(_WorkspaceHeader)
            mlflow.set_tracking_uri(mlflow_uri)
            mlflow.set_experiment(mlflow_experiment)
            mlflow.start_run(run_name="genesis-gd")
            mlflow.log_params({"epochs": epochs, "lr": lr})
            print(f"MLflow: logging to {mlflow_uri} (workspace={mlflow_workspace}, experiment={mlflow_experiment})")
        except Exception as e:
            print(f"MLflow tracking disabled: {e}")
            USE_MLFLOW = False

    d = json.load(open(train.path))
    x = np.array(d["x"]); y = np.array(d["y"])

    w, b = 0.0, 0.0                       # a model is just its parameters
    history = []
    for epoch in range(epochs):
        yhat = w * x + b                  # PREDICT: apply current belief
        err = yhat - y                    # how wrong, per example
        loss = float((err ** 2).mean())   # LOSS: one number to push down (MSE)
        dw = float(2 * (err * x).mean())  # GRADIENT: downhill direction for w
        db = float(2 * err.mean())        #           downhill direction for b
        w -= lr * dw                      # LEARN: step downhill
        b -= lr * db
        if USE_MLFLOW:
            mlflow.log_metric("loss", loss, step=epoch)   # the dropping loss curve
            mlflow.log_metric("w", w, step=epoch)         # w crawling 0 -> 2
            mlflow.log_metric("b", b, step=epoch)         # b crawling 0 -> 1
        if epoch % max(1, epochs // 20) == 0 or epoch == epochs - 1:
            history.append({"epoch": epoch, "loss": loss, "w": w, "b": b})
            print(f"epoch {epoch:4d}  loss={loss:.4f}  w={w:.4f}  b={b:.4f}")

    json.dump({"w": w, "b": b, "history": history}, open(model.path, "w"))
    # surface the learned parameters + final loss in the Experiments UI
    metrics.log_metric("final_train_loss", round(loss, 6))
    metrics.log_metric("learned_w", round(w, 4))
    metrics.log_metric("learned_b", round(b, 4))
    if USE_MLFLOW:
        mlflow.log_metric("final_train_loss", round(loss, 6))
        mlflow.log_metric("learned_w", round(w, 4))
        mlflow.log_metric("learned_b", round(b, 4))
        mlflow.end_run()


@dsl.component(base_image=BASE_IMAGE, packages_to_install=["numpy==2.1.3"])
def evaluate(
    test: dsl.Input[dsl.Dataset],
    model: dsl.Input[dsl.Model],
    true_w: float,
    true_b: float,
    metrics: dsl.Output[dsl.Metrics],
):
    """Did it actually learn? Two questions:
    1. Generalization — low error on the held-out points it never trained on.
    2. Recovery — did w,b land near the universe's true_w,true_b? (Only the
       demo gets to check this; in the real world you never know the truth —
       which is exactly why the test split matters.)"""
    import json
    import numpy as np

    d = json.load(open(test.path))
    x = np.array(d["x"]); y = np.array(d["y"])
    m = json.load(open(model.path))
    w, b = m["w"], m["b"]

    test_mse = float(((w * x + b - y) ** 2).mean())
    w_err = abs(w - true_w)
    b_err = abs(b - true_b)
    print(f"test MSE={test_mse:.4f}  recovered w={w:.4f} (true {true_w}, |err|={w_err:.4f})  "
          f"b={b:.4f} (true {true_b}, |err|={b_err:.4f})")
    metrics.log_metric("test_mse", round(test_mse, 6))
    metrics.log_metric("recovery_w_abs_err", round(w_err, 4))
    metrics.log_metric("recovery_b_abs_err", round(b_err, 4))
    # a single pass/fail the worker agent (and the integration test) can read
    ok = (w_err < 0.25 and b_err < 0.25)
    metrics.log_metric("learned_ok", 1.0 if ok else 0.0)
    # Hard gate: a run that did NOT recover the truth FAILS the pipeline, so a
    # SUCCEEDED run provably means "the model learned" — the integration test
    # (and the worker agent) can trust run state alone, no metric scraping.
    if not ok:
        raise RuntimeError(
            f"model did NOT recover the universe: learned w={w:.3f} (true {true_w}), "
            f"b={b:.3f} (true {true_b}); |errors|=({w_err:.3f}, {b_err:.3f}) exceed 0.25")


@dsl.pipeline(
    name="genesis-model",
    description="The smallest honest predictive model: linear regression by "
                "hand-written gradient descent, recovering a known truth.",
)
def genesis_pipeline(
    n: int = 200,
    true_w: float = 2.0,
    true_b: float = 1.0,
    noise: float = 0.5,
    seed: int = 7,
    epochs: int = 300,
    lr: float = 0.05,
    mlflow_uri: str = "https://mlflow.redhat-ods-applications.svc.cluster.local:8443",
    mlflow_workspace: str = "agent-office",
    mlflow_experiment: str = "genesis-model",
):
    data = generate_data(n=n, true_w=true_w, true_b=true_b, noise=noise, seed=seed)
    trained = train_gd(
        train=data.outputs["train"],
        epochs=epochs,
        lr=lr,
        mlflow_uri=mlflow_uri,
        mlflow_workspace=mlflow_workspace,
        mlflow_experiment=mlflow_experiment,
    )
    evaluate(
        test=data.outputs["test"],
        model=trained.outputs["model"],
        true_w=true_w,
        true_b=true_b,
    )


if __name__ == "__main__":
    compiler.Compiler().compile(genesis_pipeline, __file__.replace(".py", ".yaml").replace("pipeline.yaml", "pipeline.yaml"))
    print("compiled -> pipeline.yaml")
