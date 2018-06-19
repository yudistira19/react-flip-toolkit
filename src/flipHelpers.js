import tween from "popmotion/animations/tween"
import * as popmotionEasing from "popmotion/easing"
import parallel from "popmotion/compositors/parallel"
import * as Rematrix from "rematrix"

const getInvertedChildren = (element, id) =>
  [].slice.call(element.querySelectorAll(`*[data-inverse-flip-id="${id}"]`))

const passesComponentFilter = (flipFilters, flipId) => {
  if (typeof flipFilters === "string") {
    flipFilters = flipFilters.split(",").filter(x => x)
    if (!flipFilters.some(f => f === flipId)) {
      return false
    }
  }
  return true
}

const applyStyles = (element, { matrix, opacity }) => {
  // because matrix3d screws with opacity animations in Chrome (why??)
  element.style.transform = `matrix(${[
    matrix[0],
    matrix[1],
    matrix[4],
    matrix[5],
    matrix[12],
    matrix[13]
  ].join(", ")})`
  element.style.opacity = opacity
}

const shouldApplyTransform = (element, flipStartId, flipEndId) => {
  if (
    element.dataset.flipComponentIdFilter &&
    !passesComponentFilter(
      element.dataset.flipComponentIdFilter,
      flipStartId
    ) &&
    !passesComponentFilter(element.dataset.flipComponentIdFilter, flipEndId)
  ) {
    return false
  }
  return true
}

// if we're scaling an element and we have element children with data-inverse-flip-ids,
// apply the inverse of the transforms so that the children don't distort
const invertTransformsForChildren = (
  childElements,
  matrix,
  { flipStartId, flipEndId } = {}
) => {
  childElements.forEach(child => {
    if (!shouldApplyTransform(child, flipStartId, flipEndId)) return

    const translateX = matrix[12]
    const translateY = matrix[13]
    const scaleX = matrix[0]
    const scaleY = matrix[5]

    const inverseVals = {}
    if (child.dataset.translateX) inverseVals.translateX = -translateX / scaleX
    if (child.dataset.translateY) inverseVals.translateY = -translateY / scaleY
    if (child.dataset.scaleX) inverseVals.scaleX = 1 / scaleX
    if (child.dataset.scaleY) inverseVals.scaleY = 1 / scaleY

    child.style.transform = `translate(${inverseVals.translateX}px, ${
      inverseVals.translateY
    }px) scale(${inverseVals.scaleX}, ${inverseVals.scaleY})`
  })
}

export const getFlippedElementPositions = element => {
  return [].slice
    .apply(element.querySelectorAll("*[data-flip-id]"))
    .map(child => [
      child.dataset.flipId,
      {
        rect: child.getBoundingClientRect(),
        opacity: parseFloat(window.getComputedStyle(child).opacity),
        flipComponentId: child.dataset.flipComponentId
      }
    ])
    .reduce((acc, curr) => ({ ...acc, [curr[0]]: curr[1] }), {})
}

const rectInViewport = ({ top, bottom, left, right }) => {
  return (
    bottom > 0 &&
    top < window.innerHeight &&
    right > 0 &&
    left < window.innerWidth
  )
}

export const animateMove = ({
  inProgressAnimations = {},
  cachedFlipChildrenPositions = {},
  flipCallbacks = {},
  containerEl,
  duration,
  ease
}) => {
  const body = document.querySelector("body")
  const newFlipChildrenPositions = getFlippedElementPositions(containerEl)

  Object.keys(newFlipChildrenPositions).forEach(id => {
    if (!cachedFlipChildrenPositions[id] || !newFlipChildrenPositions[id]) {
      return
    }

    const prevRect = cachedFlipChildrenPositions[id].rect
    const currentRect = newFlipChildrenPositions[id].rect
    const prevOpacity = cachedFlipChildrenPositions[id].opacity
    const currentOpacity = newFlipChildrenPositions[id].opacity
    // don't animate invisible elements
    if (!rectInViewport(prevRect) && !rectInViewport(currentRect)) {
      return
    }
    // don't animate elements that didn't change
    if (
      prevRect.left === currentRect.left &&
      prevRect.top === currentRect.top &&
      prevRect.width === currentRect.width &&
      prevRect.height === currentRect.height &&
      prevOpacity === currentOpacity
    ) {
      return
    }

    const element = containerEl.querySelector(`*[data-flip-id="${id}"]`)

    const flipStartId = cachedFlipChildrenPositions[id].flipComponentId
    const flipEndId = element.dataset.flipComponentId

    if (!shouldApplyTransform(element, flipStartId, flipEndId)) return

    const currentTransform = Rematrix.parse(
      getComputedStyle(element)["transform"]
    )

    const toVals = { matrix: currentTransform }

    const fromVals = {}
    const transformsArray = [currentTransform]
    // we're only going to animate the values that the child wants animated,
    // based on its data-* attributes
    if (element.dataset.translateX) {
      transformsArray.push(
        Rematrix.translateX(prevRect.left - currentRect.left)
      )
    }
    if (element.dataset.translateY) {
      transformsArray.push(Rematrix.translateY(prevRect.top - currentRect.top))
    }
    if (element.dataset.scaleX) {
      transformsArray.push(
        Rematrix.scaleX(prevRect.width / Math.max(currentRect.width, 0.0001))
      )
    }
    if (element.dataset.scaleY) {
      transformsArray.push(
        Rematrix.scaleY(prevRect.height / Math.max(currentRect.height, 0.0001))
      )
    }
    if (element.dataset.opacity) {
      fromVals.opacity = prevOpacity
      toVals.opacity = currentOpacity
    }

    if (element.dataset.transformOrigin) {
      element.style.transformOrigin = element.dataset.transformOrigin
    }
    getInvertedChildren(element, id).forEach(child => {
      if (child.dataset.transformOrigin) {
        child.style.transformOrigin = child.dataset.transformOrigin
      }
    })

    if (inProgressAnimations[id]) {
      inProgressAnimations[id].stop()
      inProgressAnimations[id].onComplete()
      delete inProgressAnimations[id]
    }

    fromVals.matrix = transformsArray.reduce(Rematrix.multiply)

    // before animating, immediately apply FLIP styles to prevent flicker
    applyStyles(element, fromVals)
    invertTransformsForChildren(getInvertedChildren(element, id), fromVals, {
      flipStartId,
      flipEndId
    })

    if (flipCallbacks[id] && flipCallbacks[id].onStart)
      flipCallbacks[id].onStart(element, flipStartId)

    const settings = {
      duration: element.dataset.flipDuration || duration,
      ease:
        (element.dataset.flipEase &&
          popmotionEasing[element.dataset.flipEase]) ||
        popmotionEasing[ease]
    }

    let onComplete = () => {}
    if (flipCallbacks[id] && flipCallbacks[id].onComplete) {
      onComplete = () => flipCallbacks[id].onComplete(element, flipStartId)
    }

    // now start the animation

    const { stop } = parallel(
      tween({
        from: fromVals.matrix,
        to: toVals.matrix,
        ...settings
      }),
      tween({
        from: { opacity: fromVals.opacity },
        to: { opacity: toVals.opacity },
        ...settings
      })
    ).start({
      update: ([matrix, otherVals]) => {
        if (!body.contains(element)) {
          stop && stop()
          return
        }
        applyStyles(element, { ...otherVals, matrix })

        // for children that requested it, cancel out the transform by applying the inverse transform
        invertTransformsForChildren(getInvertedChildren(element, id), matrix, {
          flipStartId,
          flipEndId
        })
      },
      complete: () => {
        delete inProgressAnimations[id]
        requestAnimationFrame(() => {
          element.style.transform = ""
        })
        onComplete()
      }
    })
    // in case we have to cancel
    inProgressAnimations[id] = { stop, onComplete }
  })
  return inProgressAnimations
}
