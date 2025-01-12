// Adapted into a custom effect (for tresjs post-processing), this shader code is based on Maxime Heckel's article about his research on the Kuwahara effect:
// https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/ ———— https://x.com/MaximeHeckel

import { Uniform, Vector2 } from 'three'
import { BlendFunction, Effect } from 'postprocessing'

const fragmentShader = `
#define SECTOR_COUNT 8

uniform float radius;

float polynomialWeight(float x, float y, float eta, float lambda) {
    float polyValue = (x + eta) - lambda * (y * y);
    return max(0.0, polyValue * polyValue);
}

void getSectorVarianceAndAverageColor(mat2 anisotropyMat, float angle, float radius, out vec3 avgColor, out float variance) {
    vec3 weightedColorSum = vec3(0.0);
    vec3 weightedSquaredColorSum = vec3(0.0);
    float totalWeight = 0.0;

    float eta = 0.1;
    float lambda = 0.5;
    float angleStep = 0.196349; // Precompute angle step
    float halfAngleRange = 0.392699; // Precompute half angle range

    float cosAngle = cos(angle);
    float sinAngle = sin(angle);

    for (float r = 1.0; r <= radius; r += 1.0) {
        float rCosAngle = r * cosAngle;
        float rSinAngle = r * sinAngle;
        for (float a = -halfAngleRange; a <= halfAngleRange; a += angleStep) {
            float cosA = cos(a);
            float sinA = sin(a);
            vec2 sampleOffset = vec2(rCosAngle * cosA - rSinAngle * sinA, rCosAngle * sinA + rSinAngle * cosA) / resolution;
            sampleOffset *= anisotropyMat;

            vec3 color = texture2D(inputBuffer, vUv + sampleOffset).rgb;
            float weight = polynomialWeight(sampleOffset.x, sampleOffset.y, eta, lambda);
            
            weightedColorSum += color * weight;
            weightedSquaredColorSum += color * color * weight;
            totalWeight += weight;
        }
    }

    // Calculate average color and variance
    avgColor = weightedColorSum / totalWeight;
    vec3 varianceRes = (weightedSquaredColorSum / totalWeight) - (avgColor * avgColor);
    variance = dot(varianceRes, vec3(0.299, 0.587, 0.114)); // Convert to luminance
}

vec4 getDominantOrientation(vec4 structureTensor) {
    float Jxx = structureTensor.r; 
    float Jyy = structureTensor.g; 
    float Jxy = structureTensor.b; 

    float trace = Jxx + Jyy;
    float det = Jxx * Jyy - Jxy * Jxy;
    float lambda1 = 0.5 * (trace + sqrt(trace * trace - 4.0 * det));
    float lambda2 = 0.5 * (trace - sqrt(trace * trace - 4.0 * det));

    float dominantOrientation = atan(2.0 * Jxy, Jxx - Jyy) / 2.0;
    return vec4(dominantOrientation, lambda1, lambda2, 0.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 structureTensor = texture2D(inputBuffer, uv);

    vec3 sectorAvgColors[SECTOR_COUNT];
    float sectorVariances[SECTOR_COUNT];

    vec4 orientationAndAnisotropy = getDominantOrientation(structureTensor);
    vec2 orientation = orientationAndAnisotropy.xy;

    float anisotropy = (orientationAndAnisotropy.z - orientationAndAnisotropy.w) / (orientationAndAnisotropy.z + orientationAndAnisotropy.w + 1e-7);

    float alpha = 25.0;
    float scaleX = alpha / (anisotropy + alpha);
    float scaleY = (anisotropy + alpha) / alpha;

    mat2 anisotropyMat = mat2(orientation.x, -orientation.y, orientation.y, orientation.x) * mat2(scaleX, 0.0, 0.0, scaleY);

    for (int i = 0; i < SECTOR_COUNT; i++) {
      float angle = float(i) * 6.28318 / float(SECTOR_COUNT); // 2π / SECTOR_COUNT
      getSectorVarianceAndAverageColor(anisotropyMat, angle, float(radius), sectorAvgColors[i], sectorVariances[i]);
    }

    float minVariance = sectorVariances[0];
    vec3 finalColor = sectorAvgColors[0];

    for (int i = 1; i < SECTOR_COUNT; i++) {
        if (sectorVariances[i] < minVariance) {
            minVariance = sectorVariances[i];
            finalColor = sectorAvgColors[i];
        }
    }

    outputColor = vec4(finalColor, inputColor.a);
}
`

export class KuwaharaEffect extends Effect {
  /**
   * Creates a new KuwaharaEffect instance.
   *
   * @param {object} [options] - Configuration options for the effect.
   * @param {BlendFunction} [options.blendFunction] - Blend mode.
   * @param {number} [options.radius] - Intensity of the effect.
   *
   */
  constructor({ blendFunction = BlendFunction.NORMAL, radius = 1 } = {}) {
    super('KuwaharaEffect', fragmentShader, {
      blendFunction,
      uniforms: new Map([
        ['radius', new Uniform(radius)],
      ]),
    })
  }

  /**
   * The radius.
   *
   * @type {number}
   */

  get radius() {
    return this.uniforms.get('radius')?.value
  }

  set radius(value) {
    this.uniforms.get('radius')!.value = value
  }
}
