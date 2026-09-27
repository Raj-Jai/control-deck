package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	uinputPath   = "/dev/uinput"
	evKey        = 0x01
	evSyn        = 0x00
	synReport    = 0x00
	busUsb       = 0x03
	uiDevCreate  = 0x5501
	uiDevDestroy = 0x5502
	uiSetEvBit   = 0x40045564
	uiSetKeyBit  = 0x40045565
	maxKey       = 0x2ff
)

type inputEvent struct {
	Time  syscall.Timeval
	Type  uint16
	Code  uint16
	Value int32
}

type uinputUserDev struct {
	Name         [80]byte
	ID           struct{ Bus, Vendor, Product, Version uint16 }
	FFEffectsMax uint32
	AbsMax       [64]int32
	AbsMin       [64]int32
	AbsFuzz      [64]int32
	AbsFlat      [64]int32
}

var keyMap = map[string]uint16{
	"f":     33,
	"c":     46,
	"F11":   87,
	"F5":    63,
	"F9":    66,
	"F10":   67,
	"tab":   15,
	"esc":   1,
	"enter": 28,
	"up":    103,
	"down":  108,
	"left":  105,
	"right": 106,
	"v":     47,
	"b":     48,
	"e":     18,
	"g":     34,
	"h":     35,
	"z":     44,
	"x":     45,
	"space": 57,
	"j":     36,
	"l":     38,
	"t":     20,
	"m":     50,
	"k":     37,
}

var ctrlKeys = map[string]uint16{
	"ctrl_c": 46,
	"ctrl_d": 32,
	"ctrl_z": 44,
	"ctrl_l": 38,
	"ctrl_a": 30,
	"ctrl_e": 18,
	"ctrl_w": 17,
	"ctrl_u": 22,
}

var shiftKeys = map[string]uint16{
	"shift_.": 52,
	"shift_,": 51,
}

func ioctl(fd, op uintptr, data unsafe.Pointer) error {
	if _, _, err := syscall.Syscall(syscall.SYS_IOCTL, fd, op, uintptr(data)); err != 0 {
		return err
	}
	return nil
}

func writeEvent(fd uintptr, eType, code uint16, value int32) error {
	ev := inputEvent{Type: eType, Code: code, Value: value}
	_, err := syscall.Write(int(fd), (*(*[unsafe.Sizeof(ev)]byte)(unsafe.Pointer(&ev)))[:])
	return err
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: sendkey <key> [player]")
		fmt.Fprintln(os.Stderr, "keys: f, c, b, e, g, h, j, k, l, m, t, v, z, x, space, F11, F5, F9, F10, tab, esc, enter, up, down, left, right")
		fmt.Fprintln(os.Stderr, "ctrl combos: ctrl_c, ctrl_d, ctrl_z, ctrl_l, ctrl_a, ctrl_e, ctrl_w, ctrl_u")
		fmt.Fprintln(os.Stderr, "shift combos: shift_., shift_,")
		fmt.Fprintln(os.Stderr, "modifiers: any key may be prefixed with ctrl+ and/or shift+, e.g. shift+F5, ctrl+shift+F5")
		os.Exit(1)
	}

	keyName := os.Args[1]

	// Modifier combos: "shift+F5", "ctrl+shift+F5". The debugger deck needs
	// Shift+F5 (stop), Shift+F11 (step out) and Ctrl+Shift+F5 (restart), and
	// there was no way to express any of them, so three different buttons all
	// sent a bare F5.
	wantCtrl, wantShift := false, false
	base := keyName
	for {
		switch {
		case strings.HasPrefix(base, "ctrl+"):
			wantCtrl, base = true, base[len("ctrl+"):]
		case strings.HasPrefix(base, "shift+"):
			wantShift, base = true, base[len("shift+"):]
		default:
			goto parsed
		}
	}
parsed:
	// Candidate spellings, in order: the stripped base, the original name, and
	// the original with "+" written as "_" so that "shift+." finds the named
	// combo "shift_." that predates the modifier prefix.
	keyCode, ok := keyMap[base]
	ctrlCode, isCtrl := ctrlKeys[base]
	shiftCode, isShift := shiftKeys[base]
	if !ok && !isCtrl && !isShift {
		for _, alt := range []string{keyName, strings.ReplaceAll(keyName, "+", "_")} {
			keyCode, ok = keyMap[alt]
			ctrlCode, isCtrl = ctrlKeys[alt]
			shiftCode, isShift = shiftKeys[alt]
			if ok || isCtrl || isShift {
				break
			}
		}
	}
	if !ok && !isCtrl && !isShift {
		fmt.Fprintf(os.Stderr, "unknown key: %s\n", base)
		os.Exit(1)
	}
	// A bare "shift+x" or "ctrl+x" keeps its existing meaning.
	if isCtrl && !wantCtrl && !wantShift {
		wantCtrl, ctrlCode = true, ctrlCode
		isCtrl = false
	}
	if isShift && !wantShift && !wantCtrl {
		wantShift, shiftCode = true, shiftCode
		isShift = false
	}

	player := ""
	if len(os.Args) > 2 {
		player = os.Args[2]
	}

	if player != "" {
		busName := "org.mpris.MediaPlayer2." + player
		exec.Command("gdbus", "call", "--session",
			"--dest", busName,
			"--object-path", "/org/mpris/MediaPlayer2",
			"--method", "org.mpris.MediaPlayer2.Raise").Run()
		time.Sleep(200 * time.Millisecond)
	}

	fd, err := syscall.Open(uinputPath, syscall.O_RDWR, 0)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open uinput: %v\n", err)
		os.Exit(1)
	}
	defer syscall.Close(fd)

	if err := ioctl(uintptr(fd), uiSetEvBit, unsafe.Pointer(uintptr(evKey))); err != nil {
		fmt.Fprintf(os.Stderr, "UI_SET_EVBIT KEY: %v\n", err)
		os.Exit(1)
	}

	if err := ioctl(uintptr(fd), uiSetEvBit, unsafe.Pointer(uintptr(evSyn))); err != nil {
		fmt.Fprintf(os.Stderr, "UI_SET_EVBIT SYN: %v\n", err)
		os.Exit(1)
	}

	for k := uintptr(0); k <= maxKey; k++ {
		if ioctl(uintptr(fd), uiSetKeyBit, unsafe.Pointer(k)) != nil {
			break
		}
	}

	dev := uinputUserDev{}
	copy(dev.Name[:], []byte("tab-dashboard-keyboard"))
	dev.ID.Bus = busUsb
	dev.ID.Vendor = 1
	dev.ID.Product = 1
	dev.ID.Version = 1

	buf := (*(*[unsafe.Sizeof(dev)]byte)(unsafe.Pointer(&dev)))[:]
	if _, err := syscall.Write(int(fd), buf); err != nil {
		fmt.Fprintf(os.Stderr, "write dev struct: %v\n", err)
		os.Exit(1)
	}

	if err := ioctl(uintptr(fd), uiDevCreate, unsafe.Pointer(nil)); err != nil {
		fmt.Fprintf(os.Stderr, "UI_DEV_CREATE: %v\n", err)
		os.Exit(1)
	}
	defer ioctl(uintptr(fd), uiDevDestroy, unsafe.Pointer(nil))

	time.Sleep(100 * time.Millisecond)

	// Press the modifiers, the key, then release in reverse.
	const keyLeftCtrl = 29
	const keyLeftShift = 42

	var modsDown []uint16
	if wantCtrl {
		modsDown = append(modsDown, keyLeftCtrl)
	}
	if wantShift {
		modsDown = append(modsDown, keyLeftShift)
	}
	target := keyCode
	if isCtrl {
		target = ctrlCode
	} else if isShift {
		target = shiftCode
	}

	for _, m := range modsDown {
		writeEvent(uintptr(fd), evKey, m, 1)
	}
	writeEvent(uintptr(fd), evKey, target, 1)
	writeEvent(uintptr(fd), evSyn, synReport, 0)
	time.Sleep(50 * time.Millisecond)
	writeEvent(uintptr(fd), evKey, target, 0)
	for i := len(modsDown) - 1; i >= 0; i-- {
		writeEvent(uintptr(fd), evKey, modsDown[i], 0)
	}
	writeEvent(uintptr(fd), evSyn, synReport, 0)

	fmt.Fprintf(os.Stderr, "sent key %s\n", keyName)
}
