var Blackmarble = function Blackmarble(container, blackfriday, s) {
    var stats = s;
    var blackfriday = blackfriday;
    var PI = Math.PI;
    var PI_HALF = PI / 2;

    // Three.js objects
    var camera;
    var fov = 30.0;
    var zoomTarget = 1.0;
    var scene;
    var directionalLight;
    var renderer;

    var clock = new THREE.Clock();
    var tick = 0;
    var delta = 0;

    var earth;
    var earthGeometry;
    var earthPosition;
    var earthMaterialShader, cloudMaterialShader, atmosphereMaterialShader;

    // camera's distance from center (and thus the globe)
    var distance = 1000;

    // camera's position
    var rotation = { x: 2, y: 1 };
    var target = { x: 2, y: 1 };
    var preset = { x: 2, y: 1 };

    var ROTATIONSPEED = 0.02;
    var rotationSpeed = ROTATIONSPEED;
    var rotate = false;
    var drag = false;

    var particleSystem;
    var particles = [];

    var sprite;
    var perlin;

    var debugTime = 0;


    // What gets exposed by calling:
    //
    //    var globe = [new] Globe(div);
    //
    // attach public functions to this object
    var api = {};

    /**
     * Initializes the globe
     *
     */
    api.init = function(interactive) {
        setSize();

        // Camera
        camera = new THREE.PerspectiveCamera(fov, w / h, 1, 10000);
        camera.position.z = distance;

        // Scene
        scene = new THREE.Scene();

        // Add meshes to scene
        if (blackfriday) {
            scene.add(createMesh.blackearth());
        }
        else {
            scene.add(createMesh.earth());
            scene.add(createMesh.atmosphere());
            scene.add(createMesh.clouds());
        }

        // Add lights to scene
        scene.add(new THREE.AmbientLight(0xffffff));
        directionalLight = createMesh.directionalLight();
        scene.add(directionalLight);

        // Renderer
        renderer = new THREE.WebGLRenderer({antialias: true});
        renderer.setSize(w, h);

        // Add scene to DOM
        renderer.domElement.style.position = 'absolute';
        container.appendChild(renderer.domElement);

        if (interactive) {
            // DOM event handlers
            container.addEventListener('mousedown', handle.drag.start, false);
            container.addEventListener('touchstart', handle.touch.start, false);
            // Scroll for Chrome
            window.addEventListener('mousewheel', handle.scroll, false);
            // Scroll for Firefox
            window.addEventListener('DOMMouseScroll', handle.scroll, false);
        }
        window.addEventListener('resize', handle.resize, false);

        particleSystem = createMesh.particleSystem(blackfriday ? 500 : 1000);
        scene.add(particleSystem);

        sprite = new THREE.TextureLoader().load( "textures/particle2.png" );
        perlin = new THREE.TextureLoader().load( "textures/perlin-512.png" );

        // Bootstrap render
        animate();

        return this;
    }

    var setSize = function() {
        w = container.offsetWidth || window.innerWidth;
        h = container.offsetHeight || window.innerHeight;
    }

    var createMesh = {
        blackearth: function () {
            // Earth geom, used for earth & atmosphere
            earthGeometry = new THREE.SphereGeometry(200, 32, 32);

            var material;

            // Alternative shader for the "black" earth
            material = new THREE.ShaderMaterial({
                uniforms: {
                    texture: {type: 't', value: new THREE.TextureLoader().load( 'img/blackmarble/texture.jpg' )}
                },
                vertexShader: [
                    'varying vec3 vNormal;',
                    'varying vec2 vUv;',
                    'void main() {',
                    'gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
                    'vNormal = normalize( normalMatrix * normal );',
                    'vUv = uv;',
                    '}'
                ].join('\n'),
                fragmentShader: [
                    'uniform sampler2D texture;',
                    'varying vec3 vNormal;',
                    'varying vec2 vUv;',
                    'void main() {',
                    'vec3 diffuse = texture2D( texture, vUv ).xyz;',
                    'float intensity = 1.05 - dot( vNormal, vec3( 0.0, 0.0, 1.0 ) );',
                    'vec3 atmosphere = vec3( 1.0, 1.0, 1.0 ) * pow( intensity, 3.0 );',
                    'gl_FragColor = vec4( diffuse + atmosphere, 1.0 );',
                    '}'
                ].join('\n')

            });

            earth = new THREE.Mesh(earthGeometry, material);
            earth.userData = { material: material };
            // we use this to correctly position camera and blocks
            earthPosition = earth.position;
            return earth;
        },
        earth: function () {
            // Earth geom, used for earth & atmosphere
            earthGeometry = new THREE.SphereGeometry(200, 64, 64);

            var material;

            material = new THREE.MeshPhongMaterial();
            material.map = new THREE.TextureLoader().load('img/bluemarble/texture.jpg');

            material.bump = new THREE.TextureLoader().load('img/bluemarble/bump.jpg');
            material.bumpScale = 1;
            material.displacementMap = new THREE.TextureLoader().load('img/bluemarble/bump.jpg');
            material.displacementScale = 1;
            material.displacementBias = 1;

            material.specularMap = new THREE.TextureLoader().load('img/bluemarble/specular.jpg');
            material.specular = new THREE.Color('grey');

            material.normalMap = new THREE.TextureLoader().load('img/bluemarble/normal.jpg');
            material.normalScale = new THREE.Vector2(1, -1);

            material.onBeforeCompile = function (shader) {
                shader.uniforms.sunPos = {type: "v3", value: new THREE.Vector3(0, 1, 0)};
                shader.uniforms.nightTexture = {
                    type: "t",
                    value: new THREE.TextureLoader().load("img/bluemarble/night.jpg")
                };
                shader.uniforms.atmosphereColor = {type: "v4", value: new THREE.Vector4(0.4, 0.75, 0.85, 1.0)};
                shader.fragmentShader = shader.fragmentShader.replace( 'void main() {', [
                    'float nightMixDay(vec3 sunPos) {',
                    '   vec3 normal = normalize(vNormal);',
                    '   normal = perturbNormal2Arb( -vViewPosition, normal );',
                    '   vec4 lDirection = viewMatrix * vec4(vec3(0,0,0)-sunPos, 0.0);',
                    '   vec3 dirVector = normalize(lDirection.xyz);',
                    '   float dotProduct = dot(normal, dirVector);',
                    '   float cosineAngleSunToNormal = clamp( dotProduct * 5.0, -1.0, 1.0);',
                    '   return cosineAngleSunToNormal * 0.5 + 0.5;',
                    '}',
                    'vec3 nightAndDay( vec3 nightColor, vec3 dayColor, vec3 sunPos) {',
                    '   return mix( dayColor, nightColor, nightMixDay(sunPos) );',
                    '}',
                    'uniform sampler2D nightTexture;',
                    'uniform vec3 sunPos;',
                    'uniform vec4 atmosphereColor;',
                    'void main() {'
                ].join('\n'));

                shader.fragmentShader = shader.fragmentShader.replace( '#include <map_fragment>', [
                    '#ifdef USE_MAP',
                    'vec4 texelColor = texture2D( map, vUv );',
                    'vec3 nightColor = texture2D( nightTexture, vUv ).rgb;',
                    'texelColor.rgb = nightAndDay( nightColor, texelColor.rgb, sunPos);',

                    // 'float intensity = 1.25 - dot( vNormal, vec3( 0.0, 0.0, 1.0 ) );',
                    // 'vec4 atmosphere = atmosphereColor * pow( intensity, 3.0 );',
                    // 'atmosphere = mix(atmosphere, vec4(0.02, 0.05, 0.15, 0.5), nightMixDay(sunPos));',
                    // 'texelColor = texelColor + atmosphere;',

                    'texelColor = mapTexelToLinear( texelColor );',
                    'diffuseColor *= texelColor;',
                    '#endif'
                ].join('\n'));
                earthMaterialShader = shader;
            };

            earth = new THREE.Mesh(earthGeometry, material);
            earth.userData = { material: material };
            // we use this to correctly position camera and blocks
            earthPosition = earth.position;
            return earth;
        },

        clouds: function() {
            var cloudTexture = new THREE.TextureLoader().load('img/bluemarble/cloud.jpg');
            cloudTexture.wrapS = cloudTexture.wrapT = THREE.RepeatWrapping;

            var material = new THREE.ShaderMaterial({
                uniforms: {
                    sunPos: {type: "v3", value: new THREE.Vector3(0, 1, 0)},
                    atmosphereColor: {type: "v4", value: new THREE.Vector4(0.4, 0.75, 0.85, 1.0)},
                    cloudTexture: {
                        type: "t",
                        value: cloudTexture
                    },
                    cloudRot: {type: "f", value: 0.0}
                },
                vertexShader: [
                    'varying vec2 vUv;',
                    'varying vec3 vNormal;',
                    'void main() {',
                    '   vUv = uv;',
                    '   vNormal = normalize( normalMatrix * normal );',
                    '   gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4( position, 1.0 );',
                    '}'
                ].join('\n'),
                fragmentShader: [
                    'uniform vec3 sunPos;',
                    'varying vec2 vUv;',
                    'varying vec3 vNormal;',
                    'uniform vec4 atmosphereColor;',
                    'uniform sampler2D cloudTexture;',
                    'uniform float cloudRot;',
                    'float nightMixDay(vec3 sunPos) {',
                    '   vec3 normal = normalize(vNormal);',
                    '   vec4 lDirection = viewMatrix * vec4(vec3(0,0,0)-sunPos, 0.0);',
                    '   vec3 dirVector = normalize(lDirection.xyz);',
                    '   float dotProduct = dot(normal, dirVector);',
                    '   float cosineAngleSunToNormal = clamp( dotProduct * 5.0, -1.0, 1.0);',
                    '   return cosineAngleSunToNormal * 0.5 + 0.5;',
                    '}',
                    'void main() {',
                    'vec4 cloudColor = texture2D( cloudTexture, vec2(vUv.x+cloudRot, vUv.y) ).rgba;',
                    'cloudColor.a = (cloudColor.r + cloudColor.g + cloudColor.b) / 3.5;',
                    'cloudColor.rgb = mix(vec3(1.0, 1.0, 1.0), vec3(0.02, 0.05, 0.15), nightMixDay(sunPos));',

                    'float intensity = 1.35 - dot( vNormal, vec3( 0.0, 0.0, 1.0 ) );',
                    'vec4 atmosphere = atmosphereColor * pow( intensity, 4.0 );',
                    'atmosphere = mix(atmosphere, vec4(0.02, 0.05, 0.15, 0.3), nightMixDay(sunPos));',

                    'gl_FragColor = cloudColor + atmosphere;',
                    '}'
                ].join('\n'),
                transparent: true
            });

            material.onBeforeCompile = function (shader) {
                cloudMaterialShader = shader;
            };

            var mesh = new THREE.Mesh(earthGeometry, material);
            mesh.scale.set(1.025, 1.025, 1.025);
            return mesh;
        },

        atmosphere: function() {
            var material = new THREE.ShaderMaterial({
                uniforms: {
                    sunPos: {type: "v3", value: new THREE.Vector3(0, 1, 0)},
                    atmosphereColor: {type: "v4", value: new THREE.Vector4(0.4, 0.75, 0.85, 0.3)},
                },
                vertexShader: [
                    'varying vec3 vNormal;',
                    'void main() {',
                    '   vNormal = normalize( normalMatrix * normal );',
                    '   gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
                    '}'
                ].join('\n'),
                fragmentShader: [
                    'uniform vec3 sunPos;',
                    'varying vec3 vNormal;',
                    'uniform vec4 atmosphereColor;',
                    'float nightMixDay(vec3 sunPos) {',
                    '   vec3 normal = -normalize(vNormal);',
                    '   vec4 lDirection = viewMatrix * vec4(vec3(0,0,0)-sunPos, 0.0);',
                    '   vec3 dirVector = normalize(lDirection.xyz);',
                    '   float dotProduct = dot(normal, dirVector);',
                    '   float cosineAngleSunToNormal = clamp( dotProduct * 5.0, -1.0, 1.0);',
                    '   return cosineAngleSunToNormal * 0.5 + 0.5;',
                    '}',
                    'void main() {',
                    'float intensity = pow( 0.8 - dot( vNormal, vec3( 0.0, 0.0, 1.0 ) ), 12.0 );',
                    'vec4 atmosphere = mix(vec4(0.02, 0.05, 0.15, 0.5), atmosphereColor, nightMixDay(sunPos));',
                    'gl_FragColor = atmosphere * intensity;',
                    '}'
                ].join('\n'),
                side: THREE.BackSide,
                blending: THREE.AdditiveBlending,
                transparent: true
            });

            material.onBeforeCompile = function (shader) {
                atmosphereMaterialShader = shader;
            };

            var mesh = new THREE.Mesh(earthGeometry, material);
            mesh.scale.set(1.175, 1.175, 1.175);
            return mesh;
        },

        directionalLight: function() {
            return new THREE.DirectionalLight(0xffffff, 0.65);
        },

        particleSystem: function(size) {
            return new THREE.GPUParticleSystem( {
                maxParticles: size
            } );
        },

        particle: function(color, size) {
            var geometry = new THREE.Geometry();
            var vertex = new THREE.Vector3();
            geometry.vertices.push( vertex );
            var material = new THREE.PointsMaterial( { color: color, size: size, sizeAttenuation: true, map: sprite, alphaTest: 0.0, transparent: true , blending: THREE.AdditiveBlending} );
            return new THREE.Points( geometry, material );
        },

        simpleRay: function(color, size) {
            var mesh = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, size),
                new THREE.MeshLambertMaterial({ color: color, transparent: true })
            );
            mesh.applyMatrix( new THREE.Matrix4().makeTranslation( 0, 0, -size/2 ) );
            var ray = new THREE.Object3D();
            ray.add(mesh);
            return ray;
        },

        ray: function(color) {
            // var texture = rayTexture(color);

            // return new THREE.Mesh(
            //     new THREE.BoxGeometry(1.2, 1.2, 30),
            //     new THREE.MeshLambertMaterial({ color: color, map: texture, transparent: true })
            // );

            // var geometry = new THREE.BoxBufferGeometry( 1, 1, 30 );
            // var material = new THREE.MeshBasicMaterial( { color: color, map: texture, transparent: true, side: THREE.DoubleSide} );
            // var cube = new THREE.Mesh( geometry, material );
            // return cube;

            var ray_sides_geo = new THREE.CylinderGeometry( 1.0, 1.0, 30.0, 100.0, 10.0, false );
            var ray_cap_geo = new THREE.Geometry();
            var r = 10.0;
            for (var i=0; i<100; i++) {
                var a = i * 1/100 * Math.PI * 2;
                var z = Math.sin(a);
                var x = Math.cos(a);
                var a1 = (i+1) * 1/100 * Math.PI * 2;
                var z1 = Math.sin(a1);
                var x1 = Math.cos(a1);
                ray_cap_geo.vertices.push(
                    new THREE.Vector3(new THREE.Vector3(0, 0, 0)),
                    new THREE.Vector3(new THREE.Vector3(x*r, 0, z*r)),
                    new THREE.Vector3(new THREE.Vector3(x1*r, 0, z1*r))
                );
                ray_cap_geo.faceVertexUvs[0].push([
                    new THREE.Vector2(0.5, 0.5),
                    new THREE.Vector2(x/2+0.5, z/2+0.5),
                    new THREE.Vector2(x1/2+0.5, z1/2+0.5)
                ]);
                ray_cap_geo.faces.push(new THREE.Face3(i*3, i*3+1, i*3+2));
            }
            ray_cap_geo.uvsNeedUpdate = true;
            ray_cap_geo.normalsNeedUpdate = true;
            // ray_cap_geo.computeCentroids();
            // ray_cap_geo.computeFaceNormals();

            // var ray_sides_texture =
            //     THREE.ImageUtils.loadTexture("textures/particle2.png");
            // var ray_cap_texture =
            //     THREE.ImageUtils.loadTexture("textures/particle2.png");

            var ray_mat = new THREE.MeshLambertMaterial({map:perlin, color: color, transparent: true, blending: THREE.AdditiveBlending});
            var ray_sides = new THREE.Mesh( ray_sides_geo, ray_mat );

            // var ray_cap_mat = new THREE.MeshLambertMaterial({map:perlin, color: color, transparent: true});
            var ray_cap_top = new THREE.Mesh( ray_cap_geo, ray_mat );
            var ray_cap_bottom = new THREE.Mesh( ray_cap_geo, ray_mat );
            ray_cap_top.position.y = 0.5;
            ray_cap_bottom.position.y = -0.5;
            ray_cap_top.rotation.x = Math.PI;

            // ray_cap_top.applyMatrix( new THREE.Matrix4().makeTranslation( 0, 15, 0 ) );
            ray_cap_top.applyMatrix( new THREE.Matrix4().makeRotationX(  Math.PI / 2 ) );
            // ray_cap_bottom.applyMatrix( new THREE.Matrix4().makeTranslation( 0, 15, 0 ) );
            ray_cap_bottom.applyMatrix( new THREE.Matrix4().makeRotationX(  Math.PI / 2 ) );
            // ray_sides.applyMatrix( new THREE.Matrix4().makeTranslation( 0, 15, 0 ) );
            ray_sides.applyMatrix( new THREE.Matrix4().makeRotationX(  Math.PI / 2 ) );

            var ray = new THREE.Object3D();
            ray.add(ray_sides);
            ray.add(ray_cap_top);
            ray.add(ray_cap_bottom);
            return ray;
        }
    };

    // Keep track of mouse positions
    var mouse = { x: 0, y: 0 };
    var mouseOnDown = { x: 0, y: 0 };
    var targetOnDown = { x: 0, y: 0 };

    // DOM event handlers
    var handle = {
        scroll: function(e) {
            e.preventDefault();

            // See
            // @link http://www.h3xed.com/programming/javascript-mouse-scroll-wheel-events-in-firefox-and-chrome
            if(e.wheelDelta) {
                // chrome
                var delta = e.wheelDelta * 0.5;
            } else {
                // firefox
                var delta = -e.detail * 15.0;
            }

            api.zoomRelative(delta/1000.0);

            return false;
        },

        resize: function(e) {
            setSize();
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        },

        // See
        // @link https://github.com/dataarts/webgl-globe/blob/master/globe/globe.js#L273-L334
        drag: {
            start: function(e) {
                rotationSpeed = 0;
                drag = true;

                e.preventDefault();
                container.addEventListener('mousemove', handle.drag.move, false);
                container.addEventListener('mouseup', handle.drag.end, false);
                container.addEventListener('mouseout', handle.drag.end, false);

                mouseOnDown.x = -e.clientX;
                mouseOnDown.y = e.clientY;

                targetOnDown.x = target.x;
                targetOnDown.y = target.y;

                container.style.cursor = 'move';
            },
            move: function(e) {
                mouse.x = -e.clientX;
                mouse.y = e.clientY;

                var zoomDamp = distance / 1000;

                target.x = targetOnDown.x + (mouse.x - mouseOnDown.x) * 0.005 * zoomDamp;
                target.y = targetOnDown.y + (mouse.y - mouseOnDown.y) * 0.005 * zoomDamp;

                target.y = target.y > PI_HALF ? PI_HALF : target.y;
                target.y = target.y < - PI_HALF ? - PI_HALF : target.y;

                // var dist = Math.hypot(
                //     e.touches[0].pageX - e.touches[1].pageX,
                //     e.touches[0].pageY - e.touches[1].pageY);
                // api.zoomRelative(dist);
            },
            end: function(e) {
                rotationSpeed = ROTATIONSPEED;
                drag = false;

                container.removeEventListener('mousemove', handle.drag.move, false);
                container.removeEventListener('mouseup', handle.drag.end, false);
                container.removeEventListener('mouseout', handle.drag.end, false);
                container.style.cursor = 'auto';
            }
        },
        touch: {
            start: function(e) {
                rotationSpeed = 0;
                drag = true;

                e.preventDefault();
                container.addEventListener('touchmove', handle.touch.move, false);
                container.addEventListener('touchstart', handle.touch.end, false);
                container.addEventListener('touchend', handle.touch.end, false);

                mouseOnDown.x = -e.touches[0].clientX;
                mouseOnDown.y = e.touches[0].clientY;

                targetOnDown.x = target.x;
                targetOnDown.y = target.y;

                container.style.cursor = 'move';
            },
            move: function(e) {
                mouse.x = -e.touches[0].clientX;
                mouse.y = e.touches[0].clientY;

                target.x = targetOnDown.x + (mouse.x - mouseOnDown.x) * 0.005;
                target.y = targetOnDown.y + (mouse.y - mouseOnDown.y) * 0.005;

                target.y = target.y > PI_HALF ? PI_HALF : target.y;
                target.y = target.y < - PI_HALF ? - PI_HALF : target.y;
            },
            end: function(e) {
                rotationSpeed = ROTATIONSPEED;
                drag = false;

                container.removeEventListener('touchmove', handle.touch.move, false);
                container.removeEventListener('touchstart', handle.touch.end, false);
                container.removeEventListener('touchend', handle.touch.end, false);
                container.style.cursor = 'auto';
            }
        }
    };

    var rayTexture = function(color) {
        var size = 512;

        // create canvas
        canvas = document.createElement( 'canvas' );
        canvas.width = size;
        canvas.height = size;

        // get context
        var context = canvas.getContext( '2d' );

        // draw gradient
        context.rect( 0, 0, size, size );
        var gradient = context.createLinearGradient( 0, 0, size, size );
        gradient.addColorStop(0, '#fa82a0');
        gradient.addColorStop(1, '#000000');
        context.fillStyle = gradient;
        context.fill();

        new THREE.CanvasTexture( canvas ); ;

    };

    var checkZoomBoundries = function() {
        // max zoom
        if(zoomTarget < 0.1)
            zoomTarget = 0.1;

        // min zoom
        else if(zoomTarget > 3)
            zoomTarget = 3;
    };

    var animate = function() {
        requestAnimationFrame(animate);
        levitateParticles();
        render();
    };

    var render = function() {
        if (rotate) {
            target.x -= rotationSpeed;
        }

        // Rotate towards the target
        rotation.x += (target.x - rotation.x) * 0.2;
        rotation.y += (target.y - rotation.y) * 0.2;

        camera.fov += ( zoomTarget * fov - camera.fov) * 0.3;
        camera.updateProjectionMatrix();

        // determine camera position
        set3dPosition(camera, {
            x: rotation.x,
            y: rotation.y,
            altitude: distance
        });

        var date = new Date();
        // date = new Date(date.getTime() + debugTime*60000);
        // debugTime = debugTime  + 1;
        // console.log(date);
        var sunPos = calculateSunPosition(date);
        // console.log(sunPos);
        directionalLight.position.set(sunPos.x, sunPos.y, sunPos.z);
        if (earthMaterialShader) {
            earthMaterialShader.uniforms.sunPos.value = sunPos;
            earthMaterialShader.uniforms.sunPos.needsUpdate = true;
        }
        if (cloudMaterialShader) {
            cloudMaterialShader.uniforms.sunPos.value = sunPos;
            cloudMaterialShader.uniforms.sunPos.needsUpdate = true;
            cloudMaterialShader.uniforms.cloudRot.value = cloudMaterialShader.uniforms.cloudRot.value + 0.000005;
            cloudMaterialShader.uniforms.cloudRot.needsUpdate = true;
        }
        if (atmosphereMaterialShader) {
            atmosphereMaterialShader.uniforms.sunPos.value = sunPos;
            atmosphereMaterialShader.uniforms.sunPos.needsUpdate = true;
        }
        camera.lookAt(earthPosition);
        renderer.render(scene, camera);

        if (stats) stats.update();
    }

    var toDecimalDegrees = function(decimalMinutes) {
        return decimalMinutes.degree + decimalMinutes.minutes/60 + decimalMinutes.seconds/3600;
    }

    var calculateSunPosition = function(dt) {
        // var date = {year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), hours: dt.getUTCHours(), minutes: dt.getUTCMinutes(), seconds: dt.getUTCSeconds()};
        // $const.tlong = -71.10; // longitude
        // $const.glat = 42.37; // latitude
        // $processor.init ();
        // var earth = $moshier.body.earth;
        // $processor.calc (date, earth);
        // var sun = $moshier.body.sun;
        // $processor.calc (date, sun);
        //
        // console.log(earth.position);
        // var lat = sun.position.equinoxEclipticLonLat[3];
        // var lon = sun.position.equinoxEclipticLonLat[4];
        // var temp = {lon: toDecimalDegrees(lon), lat: toDecimalDegrees(lat)};
        // // console.log(temp);
        // var pos2d = calculate2dPosition(temp);
        // return get3dPosition(pos2d.x, pos2d.y, distance);

        var temp = {lon: -(dt.getTime() / 86400000)*360 - 180, lat: 0.0};
        var pos2d = calculate2dPosition(temp);
        return get3dPosition(pos2d.x, pos2d.y, distance);
    }

    var calculate2dPosition = function(coords) {
        var phi = (coords.lon - 270) * PI / 180;
        var theta = (180 - coords.lat) * PI / 180;

        return {
            x: phi,
            y: PI - theta
        }
    }

    var set3dPosition = function(mesh, coords) {
        if(!coords)
            coords = mesh.userData;

        var x = coords.x;
        var y = coords.y;
        var altitude = coords.altitude;

        mesh.position.set(
            altitude * Math.sin(x) * Math.cos(y),
            altitude * Math.sin(y),
            altitude * Math.cos(x) * Math.cos(y)
        );
    }

    var get3dPosition = function(x, y, altitude) {
        var position = new THREE.Vector3(
            altitude * Math.sin(x) * Math.cos(y),
            altitude * Math.sin(y),
            altitude * Math.cos(x) * Math.cos(y));
        return position;
    }

    var createRay = function(properties) {
        // create mesh
        var cube = createMesh.simpleRay(properties.color, 10000);

        // calculate 2d position
        var pos2d = calculate2dPosition(properties);

        // add altitute
        pos2d.altitude = 200;

        // calculate 3d position
        set3dPosition(cube, pos2d);

        // rotate towards earth
        cube.lookAt(earthPosition);

        // cube.scale.z = properties.size;
        // cube.scale.x = properties.size;
        // cube.scale.y = properties.size;
        //
        // cube.updateMatrix();

        cube.userData = {
            age: 0,
            ttl: 10
            // x: pos2d.x,
            // y: pos2d.y,
            // altitude: 199,
            // altitude_limit: (blackfriday ? 210 : 235),
            // altitude_remove: (blackfriday ? 280 : 300),
            // speed: (blackfriday ? 20 : 100)
        };

        return cube;
    };


    var levitateParticles = function() {
        delta = clock.getDelta();
        tick += delta;
        particleSystem.update(tick);

        if ( tick < 0 ) tick = 0;
        particles.forEach(function (p, i) {
            if ( delta > 0 ) {
                if (p.userData.age > p.userData.ttl) {
                    particles.splice(i, 1);
                    scene.remove(p);

                    delete(p.userData);
                    delete(p);
                    return;
                }

                p.userData.age += delta;
            }
        });
    };

    //        Public functions
    api.zoomRelative = function(delta) {
        zoomTarget -= delta;
        checkZoomBoundries();

        return this;
    };

    api.zoomTo = function(factor) {
        zoomTarget = 1.0/factor;
        checkZoomBoundries();

        return this;
    };

    api.center = function(pos) {
        target = preset = calculate2dPosition(pos);
        return this;
    };

    api.addParticleSystem = function(data) {
        var pos2d = calculate2dPosition(data);

        var options = {
                position: get3dPosition(pos2d.x, pos2d.y, blackfriday ? 208 : 210),
                positionRandomness: 0,
                velocity: new THREE.Vector3(),
                velocityRandomness: 0,
                color: data.color,
                colorRandomness: 0,
                turbulence: 0,
                lifetime: 10,
                size: 100,
                sizeRandomness: 0
            };

        particleSystem.spawnParticle(options);
        particleSystem.spawnParticle(options);

        return this;
    };

    api.addRay = function(data) {
        var p = createRay(data);

        scene.add(p);
        particles.push(p);

        return this;
    };

    api.rotationSpeed = function(r) {
        ROTATIONSPEED = rotationSpeed = r;

        return this;
    };

    api.rotate = function(b) {
        rotate = b;
        return this;
    };

    return api;
};
