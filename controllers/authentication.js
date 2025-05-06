const mongoose = require("mongoose");
const User = mongoose.model("User");
const jwt = require("jsonwebtoken");
const agenda = require("../middlewares/agenda");
const axios = require("axios");
const { MailtrapClient } = require("mailtrap");

const TOKEN = process.env.MAILTRAP_TOKEN;
const jwt_secret = process.env.JWT_SECRET;

const client = new MailtrapClient({
    token: TOKEN,
});

const sender = {
    email: "support@youtella.ai",
    name: "Youtella",
};

const generateToken = (id) => {
    return jwt.sign({ id }, jwt_secret, {
        expiresIn: "30d",
    });
};

// Generate reset password token
const generateResetToken = (id) => {
    return jwt.sign({ id }, jwt_secret, {
        expiresIn: "10m", // Token valid for 10 minutes
    });
};

// Generate 4-digit OTP
const generateOTP = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
};

// Existing registerUser function (unchanged)
const registerUser = async (req, res) => {
    const { username, password, captcha } = req.body;

    const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

    if (!captcha) {
        return res.status(400).json({ error: "Captcha is required." });
    }

    try {
        const verifyURL = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${captcha}`;
        const { data } = await axios.post(verifyURL);

        if (!data.success) {
            return res.status(400).json({ error: "Captcha verification failed." });
        }

        if (!username) return res.status(400).json({ error: "Email is required." });
        if (!password) return res.status(400).json({ error: "Password is required." });

        const foundUser = await User.findOne({ username });
        if (foundUser) {
            return res.status(400).json({ error: "Email already in use. Try a different one." });
        }

        const user = await User.create({ ...req.body });

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

// Existing userLogin function (unchanged)
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

// Existing getUser function (unchanged)
const getUser = async (req, res) => {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
        return res.status(400).json({ error: "Invalid user" });
    }

    res.json(user);
};

// Existing updateUser function (unchanged)
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

// Initiate password reset by sending OTP
const forgotPassword = async (req, res) => {
    const { username, captcha } = req.body;
    const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

    if (!captcha) {
        return res.status(400).json({ error: "Captcha is required" });
    }

    if (!username) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
        // Verify captcha
        const verifyURL = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${captcha}`;
        const { data } = await axios.post(verifyURL);

        if (!data.success) {
            return res.status(400).json({ error: "Captcha verification failed" });
        }

        const user = await User.findOne({ username });

        if (!user) {
            return res.status(400).json({ error: "No user found with this email" });
        }

        // Generate and store OTP
        const otp = generateOTP();
        user.resetPasswordOTP = otp;
        user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
        await user.save();

        // Generate reset token
        const resetToken = generateResetToken(user._id);


        await client
            .send({
                from: sender,
                to: [{ email: username }],
                template_uuid: "23bfe881-eb95-41b9-9e2d-52ff91f61efe",
                template_variables: {
                    "CODE": otp,
                }
            })

        res.status(200).json({
            success: "OTP sent to email",
            resetToken
        });
    } catch (error) {
        console.error("Forgot password error:", error.message);
        res.status(500).json({ error: "Failed to send OTP. Please try again." });
    }
};

// Verify OTP
const verifyOTP = async (req, res) => {
    const { resetToken, otp } = req.body;

    if (!resetToken || !otp) {
        return res.status(400).json({ error: "Reset token and OTP are required" });
    }

    try {
        // Verify reset token
        const decoded = jwt.verify(resetToken, jwt_secret);
        const user = await User.findOne({
            _id: decoded.id,
            resetPasswordOTP: otp,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        res.status(200).json({
            success: "OTP verified successfully",
            resetToken
        });
    } catch (error) {
        console.error("OTP verification error:", error.message);
        if (error.name === 'TokenExpiredError') {
            return res.status(400).json({ error: "Reset token has expired" });
        }
        res.status(500).json({ error: "Failed to verify OTP. Please try again." });
    }
};

// Reset password
const resetPassword = async (req, res) => {
    const { resetToken, password } = req.body;

    if (!resetToken) {
        return res.status(400).json({ error: "Inavlid request." });
    }

    if (!password) {
        return res.status(400).json({ error: "New Password is required." });
    }


    try {
        // Verify reset token
        const decoded = jwt.verify(resetToken, jwt_secret);
        const user = await User.findOne({
            _id: decoded.id,
        });

        if (!user) {
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        // Update password and clear OTP
        user.password = password;
        user.resetPasswordOTP = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.status(200).json({ success: "Password reset successfully" });
    } catch (error) {
        console.error("Password reset error:", error.message);
        if (error.name === 'TokenExpiredError') {
            return res.status(400).json({ error: "Reset token has expired" });
        }
        res.status(500).json({ error: "Failed to reset password. Please try again." });
    }
};

module.exports = {
    registerUser,
    userLogin,
    getUser,
    updateUser,
    forgotPassword,
    verifyOTP,
    resetPassword
};