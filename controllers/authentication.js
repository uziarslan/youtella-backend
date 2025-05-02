const mongoose = require("mongoose");
const User = mongoose.model("User");
const jwt = require("jsonwebtoken");
const agenda = require("../middlewares/agenda")
const axios = require("axios");


const jwt_secret = process.env.JWT_SECRET;

const generateToken = (id) => {
    return jwt.sign({ id }, jwt_secret, {
        expiresIn: "30d",
    });
};

const registerUser = async (req, res) => {
    const { username, password, captcha } = req.body;

    const RECAPTCHA_SECRET_KEY = "6LdwQywrAAAAAASyiM2WLnmUGuQ14wda47O0-muC";

    // 1. Check for captcha
    if (!captcha) {
        return res.status(400).json({ error: "Captcha is required." });
    }

    try {
        // 2. Verify captcha with Google
        const verifyURL = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${captcha}`;

        const { data } = await axios.post(verifyURL);

        if (!data.success) {
            return res.status(400).json({ error: "Captcha verification failed." });
        }

        // 3. Basic validation
        if (!username) return res.status(400).json({ error: "Email is required." });
        if (!password) return res.status(400).json({ error: "Password is required." });

        const foundUser = await User.findOne({ username });
        if (foundUser) {
            return res.status(400).json({ error: "Email already in use. Try a different one." });
        }

        // 4. Create user
        const user = await User.create({ ...req.body });

        // 5. Send response
        res.status(201).json({
            token: generateToken(user._id),
            success: "Email has been registered",
            user,
        });

    } catch (error) {
        console.error("Captcha or user registration failed:", error.message);
        res.status(500).json({ error: "Internal server error. Please try again later." });
    }
};

const userLogin = async (req, res) => {
    const { username, password } = req.body;

    const user = await User.findOne({ username });

    if (!user)
        return res.status(400).json({ error: "Invalid email or password" });

    if (await user.matchPassword(password)) {
        return res.status(201).json({
            token: generateToken(user._id),
            user: user
        });
    }
    return res.status(400).json({ error: "Invalid email or password" });
};


const getUser = async (req, res) => {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
        return res.status(400).json({ error: "Invalid user" });
    }

    res.json(user);
};

const updateUser = async (req, res) => {
    const { name, username } = req.body;
    const file = req.file;

    const user = await User.findById(req.user.id);
    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    if (!name) {
        return res.status(400).json({ error: "Name is required" });
    }
    if (!username) {
        return res.status(400).json({ error: "Email is required" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser && existingUser._id.toString() !== req.user.id) {
        return res.status(400).json({ error: "Email already in use" });
    }

    if (file) {
        try {
            const filename = user.profileImage?.filename;
            if (filename) {
                await agenda.now("deleteFileFromCloudinary", { filename });
            }

            user.profileImage = {
                path: file.path,
                filename: file.filename,
            }

        } catch (error) {
            return res.status(500).json({ error: "Failed to process profile image" });
        }
    }

    user.name = name;
    user.username = username;

    await user.save();

    return res.status(200).json({ success: "User updated successfully", user });
};

module.exports = {
    registerUser,
    userLogin,
    getUser,
    updateUser
}