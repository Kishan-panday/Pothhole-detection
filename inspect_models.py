import os
from tensorflow.keras.models import load_model
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
for name in os.listdir(BASE_DIR):
    if name.endswith('.h5'):
        path = os.path.join(BASE_DIR, name)
        try:
            model = load_model(path)
            print(name)
            print('  input_shape:', model.input_shape)
            print('  output_shape:', model.output_shape)
            print('  layers:', len(model.layers))
            print('  summary first 3 layers:')
            for layer in model.layers[:5]:
                print('   ', layer.name, layer.input_shape, layer.output_shape)
        except Exception as e:
            print(name, 'ERROR', e)
