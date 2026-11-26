"""Read Acclaim ASF/AMC capture data from the CMU Graphics Lab."""

from dataclasses import dataclass
from math import cos, radians, sin

import numpy as np


METERS_PER_UNIT = (1 / .45) * .0254
SCENE_AXES = np.array(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def rotation(angles, order):
    matrix = np.eye(3)
    for angle, axis in zip(angles, order.lower()):
        c, s = cos(radians(angle)), sin(radians(angle))
        if axis == 'x':
            step = ((1, 0, 0), (0, c, -s), (0, s, c))
        elif axis == 'y':
            step = ((c, 0, s), (0, 1, 0), (-s, 0, c))
        else:
            step = ((c, -s, 0), (s, c, 0), (0, 0, 1))
        matrix = np.asarray(step) @ matrix
    return matrix


@dataclass
class Bone:
    offset: np.ndarray
    axis: np.ndarray
    channels: str


def asf_skeleton(path):
    contents = path.read_text(encoding='ascii').splitlines()
    bones, parents = {}, {}
    section = None
    for line in contents:
        values = line.strip().split()
        if not values or values[0].startswith('#'):
            continue
        key, *data = values
        if key.startswith(':'):
            section = key
        if section == ':bonedata':
            if key == 'begin':
                bone = {}
            elif key == 'end':
                direction = np.array(bone['direction'], dtype=float)
                x, y, z, order = bone['axis']
                bones[bone['name'][0]] = Bone(float(bone['length'][0]) * direction,
                                              rotation((float(x), float(y), float(z)), order),
                                              ''.join(axis[-1] for axis in bone.get('dof', ())))
            elif key in ('name', 'direction', 'length', 'axis', 'dof'):
                bone[key] = data
        if section == ':hierarchy' and key not in (section, 'begin', 'end'):
            parents.update({child: key for child in data})
    return bones, parents


def amc_samples(path):
    poses = []
    for line in path.read_text(encoding='ascii').splitlines():
        values = line.split()
        if not values or values[0].startswith((':', '#')):
            continue
        name, *angles = values
        if name.isdecimal():
            assert int(name) == len(poses) + 1
            poses.append({})
        else:
            poses[-1][name] = np.array(angles, dtype=float)
    if not poses:
        raise ValueError(f'No capture frames in {path}')
    return poses


class Capture:
    def __init__(self, skeleton, motion):
        bones, parents = asf_skeleton(skeleton)
        self.name = motion.stem
        self.channels = amc_samples(motion)
        self.names = ('root', *parents)
        self.parent = {name: self.names.index(parent) for name, parent in parents.items()}
        self.index = {name: i for i, name in enumerate(self.names)}
        self.positions = np.empty((len(self.channels), len(self.names), 3))
        self.orientations = np.empty((len(self.channels), len(self.names), 3, 3))
        for frame, sample in enumerate(self.channels):
            points, angles = self.positions[frame], self.orientations[frame]
            points[0], angles[0] = sample['root'][:3], rotation(sample['root'][3:], 'xyz')
            for i, name in enumerate(self.names[1:], 1):
                b = bones[name]
                parent = self.parent[name]
                local = b.axis @ rotation(sample.get(name, ()), b.channels) @ b.axis.T
                angles[i] = angles[parent] @ local
                points[i] = points[parent] + angles[i] @ b.offset
        self.positions = (self.positions @ SCENE_AXES.T) * METERS_PER_UNIT
        self.orientations = SCENE_AXES @ self.orientations @ SCENE_AXES.T

    def point(self, frame, name):
        return self.positions[frame, self.index[name]]

    def orientation(self, frame, name):
        return self.orientations[frame, self.index[name]]

    def channel(self, frame, name):
        return self.channels[frame][name]
