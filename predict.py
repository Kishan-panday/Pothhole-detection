import os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
os.environ["ABSL_LOG_LEVEL"] = "3"
import sys
import json
import uuid
import cv2
import numpy as np
import tensorflow as tf
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename
from tensorflow.keras.models import load_model

# =========================
# BASIC CONFIG
# =========================
tf.get_logger().setLevel("ERROR")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB


# =========================
# CLASS LABELS
# =========================
BINARY_CLASSES = ["normal", "pothole"]
MULTI_CLASSES = ["good", "poor", "satisfactory", "very_poor"]

MULTI_CLASS_INFO = {
    "good": {
        "label": "Good",
        "description": "Excellent road condition - No maintenance needed",
        "status": "excellent",
        "emoji": "✅",
        "color": "#28a745"
    },
    "satisfactory": {
        "label": "Satisfactory",
        "description": "Adequate condition - Minor maintenance recommended",
        "status": "adequate",
        "emoji": "⚠️",
        "color": "#ffc107"
    },
    "poor": {
        "label": "Poor",
        "description": "Poor condition - Maintenance required soon",
        "status": "warning",
        "emoji": "⚠️",
        "color": "#fd7e14"
    },
    "very_poor": {
        "label": "Very Poor",
        "description": "Critical condition - Urgent repairs needed",
        "status": "critical",
        "emoji": "🚨",
        "color": "#dc3545"
    }
}

BINARY_CLASS_INFO = {
    "normal": {
        "label": "Normal Road",
        "description": "No major pothole detected",
        "status": "safe",
        "emoji": "✅",
        "color": "#28a745"
    },
    "pothole": {
        "label": "Pothole Detected",
        "description": "Road damage detected",
        "status": "danger",
        "emoji": "⚠️",
        "color": "#dc3545"
    }
}


# =========================
# MODEL STORAGE
# =========================
binary_models = []
multi_models = []
binary_model_names = []
multi_model_names = []


# =========================
# HELPER FUNCTIONS
# =========================
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def preprocess_image(image_path):
    img = cv2.imread(image_path)

    if img is None:
        raise ValueError("Could not read image")

    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (128, 128))
    img = img.astype("float32") / 255.0
    img = np.expand_dims(img, axis=0)

    return img


def load_models():
    global binary_models, multi_models, binary_model_names, multi_model_names

    if binary_models or multi_models:
        return

    # Load binary models
    for i in range(1, 6):
        model_name = f"binary_model_fold_{i}.h5"
        model_path = os.path.join(BASE_DIR, model_name)
        if os.path.exists(model_path):
            binary_models.append(load_model(model_path))
            binary_model_names.append(model_name)

    # Load multi-class models
    for i in range(1, 6):
        model_name = f"multi_model_fold_{i}.h5"
        model_path = os.path.join(BASE_DIR, model_name)
        if os.path.exists(model_path):
            multi_models.append(load_model(model_path))
            multi_model_names.append(model_name)

    if not binary_models and not multi_models:
        raise FileNotFoundError(
            "No model files found. Please keep .h5 model files in the project root folder."
        )


def ensemble_predict(models, img_input):
    predictions = []

    for model in models:
        pred = model.predict(img_input, verbose=0)[0]
        predictions.append(pred)

    avg_pred = np.mean(predictions, axis=0)
    return avg_pred


def predict_binary(image_path):
    if not binary_models:
        return None

    img_input = preprocess_image(image_path)
    avg_pred = ensemble_predict(binary_models, img_input)

    # case 1: model output shape = 2
    if len(avg_pred) == 2:
        class_index = int(np.argmax(avg_pred))
        predicted_class = BINARY_CLASSES[class_index]
        confidence = float(avg_pred[class_index] * 100)

        all_predictions = {
            BINARY_CLASSES[i]: round(float(avg_pred[i] * 100), 2)
            for i in range(len(BINARY_CLASSES))
        }

    # case 2: model output shape = 1 (sigmoid)
    elif len(avg_pred) == 1:
        pothole_prob = float(avg_pred[0])
        normal_prob = 1 - pothole_prob

        if pothole_prob >= 0.5:
            predicted_class = "pothole"
            confidence = pothole_prob * 100
        else:
            predicted_class = "normal"
            confidence = normal_prob * 100

        all_predictions = {
            "normal": round(normal_prob * 100, 2),
            "pothole": round(pothole_prob * 100, 2)
        }

    else:
        raise ValueError("Unexpected binary model output shape")

    return {
        "predicted_class": predicted_class,
        "confidence": round(confidence, 2),
        "all_predictions": all_predictions,
        "class_info": BINARY_CLASS_INFO[predicted_class],
        "models_used": len(binary_models),
        "model_names": binary_model_names
    }


def predict_multi(image_path):
    if not multi_models:
        return None

    img_input = preprocess_image(image_path)
    avg_pred = ensemble_predict(multi_models, img_input)

    if len(avg_pred) not in (3, 4):
        raise ValueError("Unexpected multi-class model output shape")

    multi_classes = MULTI_CLASSES[: len(avg_pred)]
    class_index = int(np.argmax(avg_pred))
    predicted_class = multi_classes[class_index]
    confidence = float(avg_pred[class_index] * 100)

    all_predictions = {
        multi_classes[i]: round(float(avg_pred[i] * 100), 2)
        for i in range(len(multi_classes))
    }

    class_info = MULTI_CLASS_INFO.get(predicted_class, {
        "label": predicted_class,
        "description": "Road condition result",
        "status": "adequate",
        "emoji": "ℹ️",
        "color": "#6c757d"
    })

    return {
        "predicted_class": predicted_class,
        "confidence": round(confidence, 2),
        "all_predictions": all_predictions,
        "class_info": class_info,
        "models_used": len(multi_models),
        "model_names": multi_model_names
    }


def run_cli_prediction(image_path):
    load_models()

    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image file not found: {image_path}")

    multi_result = predict_multi(image_path)
    binary_result = predict_binary(image_path) if binary_models else None

    if multi_result is None and binary_result is None:
        raise RuntimeError("No prediction models are loaded")

    result = multi_result if multi_result is not None else binary_result

    output = {
        "success": True,
        "predicted_class": result["predicted_class"],
        "confidence": result["confidence"],
        "all_predictions": result["all_predictions"],
        "class_info": result["class_info"],
        "models_used": result.get("models_used"),
        "model_names": result.get("model_names"),
        "binary_result": binary_result
    }

    print(json.dumps(output))


# =========================
# ROUTES
# =========================
@app.route("/")
def home():
    try:
        return render_template("index.html")
    except:
        return """
        <h2>Road Condition Backend is Running</h2>
        <p>Use POST /predict with form-data key = image</p>
        """


@app.route("/health", methods=["GET"])
def health():
    try:
        load_models()
        return jsonify({
            "status": "ok",
            "binary_models_loaded": len(binary_models),
            "multi_models_loaded": len(multi_models),
            "binary_model_names": binary_model_names,
            "multi_model_names": multi_model_names
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/predict", methods=["POST"])
def predict():
    try:
        load_models()

        if "image" not in request.files:
            return jsonify({"error": "No image uploaded"}), 400

        file = request.files["image"]

        if file.filename == "":
            return jsonify({"error": "No file selected"}), 400

        if not allowed_file(file.filename):
            return jsonify({
                "error": "Invalid file type. Allowed types: png, jpg, jpeg, webp"
            }), 400

        filename = secure_filename(file.filename)
        extension = filename.rsplit(".", 1)[1].lower()
        unique_filename = f"{uuid.uuid4().hex}.{extension}"
        file_path = os.path.join(app.config["UPLOAD_FOLDER"], unique_filename)

        file.save(file_path)

        binary_result = predict_binary(file_path)
        multi_result = predict_multi(file_path)

        final_result = {
            "success": True,
            "uploaded_image": f"/static/uploads/{unique_filename}",
            "filename": filename,
            "binary_result": binary_result,
            "multi_result": multi_result
        }

        return jsonify(final_result)

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File too large. Maximum size is 10 MB."}), 413


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Route not found"}), 404


# =========================
# MAIN
# =========================
if __name__ == "__main__":
    if len(sys.argv) == 2:
        try:
            run_cli_prediction(sys.argv[1])
        except Exception as e:
            error_output = {"success": False, "error": str(e)}
            print(json.dumps(error_output))
            sys.exit(1)
    else:
        port = int(os.environ.get("PORT", 5000))
        app.run(host="0.0.0.0", port=port, debug=True)