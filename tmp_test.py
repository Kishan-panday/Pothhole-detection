import numpy as np
import cv2
img = np.zeros((224,224,3), dtype=np.uint8)
cv2.imwrite('test.png', img)
print('CREATED test.png')
